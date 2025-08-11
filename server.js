const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let pendingOrders = new Map();       // ticket -> dati ordini pendenti attivi
let filledTrades = new Map();        // ticket -> dati trade fillati dal Master  
let recentEvents = [];               // eventi recenti (cancel, modify, trade_closed)
let masterAccountInfo = {};          // ultima informazione account Master
let connectedSlaves = new Map();     // slaveKey -> ultimo accesso

// Chiavi di sicurezza
const MASTER_KEY = "master_secret_key_2024";
const SLAVE_KEY = "slave_access_key_2025_08";

// Middleware per autenticazione Slave
function authenticateSlave(req, res, next) {
  const { slavekey } = req.query;
  
  if (!slavekey || slavekey !== SLAVE_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid slave key required' 
    });
  }
  
  // Registra accesso slave
  const slaveId = req.ip + '_' + (req.headers['user-agent'] || 'unknown');
  connectedSlaves.set(slaveId, {
    lastAccess: new Date(),
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  next();
}

// Funzione per aggiornare informazioni account Master
function updateMasterAccountInfo(accountData) {
  if (accountData && typeof accountData === 'object') {
    masterAccountInfo = {
      ...accountData,
      lastUpdated: new Date()
    };
    console.log(`💰 Account Master aggiornato: Balance: ${accountData.balance}, Equity: ${accountData.equity}`);
  }
}

//+------------------------------------------------------------------+
//| ENDPOINT 1: Health Check                                        |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    time: new Date(),
    pendingOrders: pendingOrders.size,
    filledTrades: filledTrades.size,
    recentEvents: recentEvents.length,
    connectedSlaves: connectedSlaves.size,
    masterAccount: masterAccountInfo.number || 'N/A'
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Master invia segnali                                |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
  const {
    masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
    expiration, account, barsFromPlacement, timeframe, timeframeName,
    openPrice, closePrice, openTime, closeTime, profit, swap, commission
  } = req.body;

  if (masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date();
  const ticketNum = parseInt(ticket);

  if (action === 'pending') {
    // Nuovo ordine pendente - SOLO se non è già stato fillato
    if (filledTrades.has(ticketNum)) {
      console.log(`⚠️ PENDENTE GIÀ FILLATO: #${ticket} non aggiunto (già eseguito nel Master)`);
      res.json({ status: 'already_filled' });
      return;
    }

    const pendingOrder = {
      signalType: 'pending',
      ticket: ticketNum,
      symbol,
      type,
      lots,
      price,
      sl,
      tp,
      time,
      comment,
      expiration,
      barsFromPlacement: barsFromPlacement || 0,
      timeframe: timeframe || 0,
      timeframeName: timeframeName || 'Unknown',
      timestamp
    };
    
    pendingOrders.set(ticketNum, pendingOrder);
    if (account) updateMasterAccountInfo(account);
    
    console.log(`🟡 PENDENTE AGGIUNTO - Ticket: #${ticket} ${symbol} @ ${price} (Pendenti: ${pendingOrders.size})`);

  } else if (action === 'modify') {
    // Modifica ordine pendente - SOLO se non è fillato
    if (filledTrades.has(ticketNum)) {
      console.log(`⚠️ MODIFY IGNORATO: #${ticket} già fillato nel Master`);
      res.json({ status: 'already_filled' });
      return;
    }

    if (pendingOrders.has(ticketNum)) {
      const existing = pendingOrders.get(ticketNum);
      const updated = {
        ...existing,
        lots,
        price,
        sl,
        tp,
        expiration,
        barsFromPlacement: barsFromPlacement || existing.barsFromPlacement,
        timeframe: timeframe || existing.timeframe,
        timeframeName: timeframeName || existing.timeframeName,
        modified: true,
        timestamp
      };
      
      pendingOrders.set(ticketNum, updated);
      
      // Aggiungi evento di modifica
      recentEvents.push({
        signalType: 'modify',
        action: 'modify',
        ticket: ticketNum,
        symbol,
        price,
        sl,
        tp,
        expiration,
        barsFromPlacement,
        timeframe,
        timeframeName,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`🔄 PENDENTE MODIFICATO - Ticket: #${ticket} @ ${price}`);
      
    } else {
      console.warn(`⚠️ Tentativo di modificare pendente non esistente: #${ticket}`);
    }

  } else if (action === 'silentBarsUpdate') {
    // Aggiornamento silenzioso delle barre per nuovi Slave
    if (pendingOrders.has(ticketNum)) {
      const existing = pendingOrders.get(ticketNum);
      const updated = {
        ...existing,
        barsFromPlacement: barsFromPlacement,
        timeframe: timeframe || existing.timeframe,
        timeframeName: timeframeName || existing.timeframeName,
        lastBarsUpdate: timestamp
      };
      
      pendingOrders.set(ticketNum, updated);
      
      console.log(`📊 BARRE AGGIORNATE SILENZIOSAMENTE - Ticket: #${ticket} -> ${barsFromPlacement} barre`);
      
    } else {
      console.warn(`⚠️ Tentativo di aggiornare barre per pendente non esistente: #${ticket}`);
    }

    if (account) updateMasterAccountInfo(account);

  } else if (action === 'filled') {
    // Pendente eseguito nel Master
    if (pendingOrders.has(ticketNum)) {
      const originalPending = pendingOrders.get(ticketNum);
      
      // Sposta da pendenti a fillati
      pendingOrders.delete(ticketNum);
      
      const filledTrade = {
        signalType: 'filled',
        originalTicket: ticketNum,
        symbol: originalPending.symbol,
        type: originalPending.type,
        lots: originalPending.lots,
        originalPrice: originalPending.price,
        fillPrice: price || originalPending.price,
        sl: originalPending.sl,
        tp: originalPending.tp,
        fillTime: time,
        timestamp,
        // Mantieni dati originali per lo slave
        barsFromPlacement: originalPending.barsFromPlacement,
        timeframe: originalPending.timeframe,
        timeframeName: originalPending.timeframeName
      };
      
      filledTrades.set(ticketNum, filledTrade);
      
      // Rimuovi eventi obsoleti per questo ticket
      const eventsBefore = recentEvents.length;
      recentEvents = recentEvents.filter(event => {
        return !(event.ticket && event.ticket === ticketNum);
      });
      const eventsAfter = recentEvents.length;
      const removedEvents = eventsBefore - eventsAfter;
      
      console.log(`🔵 PENDENTE FILLATO NEL MASTER - Ticket: #${ticket} ${originalPending.symbol}`);
      console.log(`📊 Pendenti: ${pendingOrders.size}, Fillati: ${filledTrades.size}`);
      if (removedEvents > 0) {
        console.log(`🧹 Rimossi ${removedEvents} eventi obsoleti per ticket #${ticket}`);
      }
      
    } else {
      console.warn(`⚠️ 'filled' per pendente non tracciato: #${ticket}`);
    }

    if (account) updateMasterAccountInfo(account);

  } else if (action === 'trade_closed') {
    // NUOVO: Trade chiuso nel Master
    const closedTrade = {
      signalType: 'trade_closed',
      ticket: ticketNum,
      symbol,
      type,
      lots,
      openPrice,
      closePrice,
      openTime,
      closeTime,
      profit,
      swap: swap || 0,
      commission: commission || 0,
      comment,
      timestamp
    };
    
    // Aggiungi agli eventi recenti
    recentEvents.push(closedTrade);
    
    if (account) updateMasterAccountInfo(account);
    console.log(`🔴 TRADE CHIUSO - Ticket: #${ticket} ${symbol} Profit: ${profit}`);

  } else if (action === 'cancel') {
    // Ordine pendente cancellato manualmente dal Master
    if (pendingOrders.has(ticketNum)) {
      const cancelledOrder = pendingOrders.get(ticketNum);
      pendingOrders.delete(ticketNum);
      
      // Rimuovi eventi correlati
      const eventsBefore = recentEvents.length;
      recentEvents = recentEvents.filter(event => {
        return !(event.ticket && event.ticket === ticketNum);
      });
      const eventsAfter = recentEvents.length;
      const removedEvents = eventsBefore - eventsAfter;
      
      // Aggiungi evento di cancellazione
      recentEvents.push({
        signalType: 'cancel',
        action: 'cancel',
        ticket: ticketNum,
        symbol: cancelledOrder.symbol,
        canceltime: time,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`❌ PENDENTE CANCELLATO - Ticket: #${ticket} (Pendenti: ${pendingOrders.size})`);
      if (removedEvents > 0) {
        console.log(`🧹 Rimossi ${removedEvents} eventi obsoleti per ticket #${ticket}`);
      }
      
    } else if (filledTrades.has(ticketNum)) {
      // Tentativo di cancellare un trade già fillato - ignora
      console.log(`ℹ️ CANCEL IGNORATO: #${ticket} già fillato, non più cancellabile`);
    } else {
      console.warn(`⚠️ Tentativo di cancellare pendente non esistente: #${ticket}`);
    }
  }

  // Mantieni ultimi 100 eventi
  if (recentEvents.length > 100) {
    recentEvents = recentEvents.slice(-100);
  }

  res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Client get signals (CON AUTENTICAZIONE SLAVE)       |
//+------------------------------------------------------------------+
app.get('/api/getsignals', authenticateSlave, (req, res) => {
  const { lastsync } = req.query;
  
  const response = {
    pendingOrders: [],
    filledTrades: [],
    recentEvents: [],
    masterAccount: masterAccountInfo,
    serverTime: Date.now()
  };

  // Converti Maps in Arrays
  pendingOrders.forEach(order => response.pendingOrders.push(order));
  filledTrades.forEach(trade => response.filledTrades.push(trade));

  // Filtra eventi recenti se lastsync è specificato
  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentEvents = recentEvents.filter(event => event.timestamp > syncTime);
  } else {
    response.recentEvents = recentEvents;
  }

  console.log(`📤 Segnali inviati a SLAVE: pendingOrders=${response.pendingOrders.length}, filledTrades=${response.filledTrades.length}, recentEvents=${response.recentEvents.length}`);

  res.json(response);
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Slave notifica esecuzione locale (CON AUTH)         |
//+------------------------------------------------------------------+
app.post('/api/slave-filled', authenticateSlave, (req, res) => {
  const { ticket } = req.body;
  const ticketNum = parseInt(ticket);
  
  if (filledTrades.has(ticketNum)) {
    // Rimuovi il trade fillato quando lo slave conferma l'esecuzione
    filledTrades.delete(ticketNum);
    console.log(`✅ SLAVE CONFERMA ESECUZIONE: Ticket #${ticket} rimosso dai fillati (rimasti: ${filledTrades.size})`);
    res.json({ status: 'confirmed' });
  } else {
    console.warn(`⚠️ Slave conferma esecuzione per ticket non fillato: #${ticket}`);
    res.json({ status: 'not_found' });
  }
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Statistiche dettagliate                             |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  const stats = {};
  
  // Analisi per simbolo
  pendingOrders.forEach(order => {
    if (!stats[order.symbol]) {
      stats[order.symbol] = { pendingOrders: 0, filledTrades: 0, timeframes: [] };
    }
    stats[order.symbol].pendingOrders++;
    if (order.timeframeName && !stats[order.symbol].timeframes.includes(order.timeframeName)) {
      stats[order.symbol].timeframes.push(order.timeframeName);
    }
  });

  filledTrades.forEach(trade => {
    if (!stats[trade.symbol]) {
      stats[trade.symbol] = { pendingOrders: 0, filledTrades: 0, timeframes: [] };
    }
    stats[trade.symbol].filledTrades++;
  });

  // Pulisci slave disconnessi (oltre 5 minuti)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  connectedSlaves.forEach((data, slaveId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedSlaves.delete(slaveId);
    }
  });

  res.json({
    summary: {
      pendingOrders: pendingOrders.size,
      filledTrades: filledTrades.size,
      recentEvents: recentEvents.length,
      connectedSlaves: connectedSlaves.size
    },
    symbolBreakdown: stats,
    recentEvents: recentEvents.slice(-10),
    masterAccount: masterAccountInfo,
    connectedSlaves: Array.from(connectedSlaves.entries()).map(([id, data]) => ({
      id: id.substr(0, 20) + '...',
      lastAccess: data.lastAccess,
      ip: data.ip
    })),
    serverUptime: process.uptime()
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 6: Reset completo                                      |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  pendingOrders.clear();
  filledTrades.clear();
  recentEvents = [];
  masterAccountInfo = {};
  connectedSlaves.clear();

  console.log('🧹 RESET COMPLETO - Tutti i dati cancellati');
  res.json({ status: 'success', message: 'Complete reset performed' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 7: Debug - Stato interno                               |
//+------------------------------------------------------------------+
app.get('/api/debug', (req, res) => {
  res.json({
    pendingOrders: Object.fromEntries(pendingOrders),
    filledTrades: Object.fromEntries(filledTrades),
    recentEvents,
    masterAccount: masterAccountInfo,
    connectedSlaves: Object.fromEntries(connectedSlaves)
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 8: Verifica chiave slave                               |
//+------------------------------------------------------------------+
app.post('/api/verify-slave', (req, res) => {
  const { slavekey } = req.body;
  
  if (slavekey === SLAVE_KEY) {
    res.json({ 
      status: 'authorized',
      message: 'Slave key valid',
      serverTime: Date.now()
    });
  } else {
    res.status(401).json({ 
      status: 'unauthorized',
      message: 'Invalid slave key'
    });
  }
});

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 EA Advanced Pending API v7.0 avviata su port ${PORT}`);
  console.log(`📋 Endpoints disponibili:`);
  console.log(`   GET  /api/health           - Health check`);
  console.log(`   POST /api/signals          - Ricevi segnali dal Master`);
  console.log(`   GET  /api/getsignals       - Ottieni segnali per Slave (AUTH)`);
  console.log(`   POST /api/slave-filled     - Slave notifica esecuzione (AUTH)`);
  console.log(`   GET  /api/stats            - Statistiche dettagliate`);
  console.log(`   POST /api/reset            - Reset completo`);
  console.log(`   GET  /api/debug            - Debug stato interno`);
  console.log(`   POST /api/verify-slave     - Verifica chiave slave`);
  console.log(`🔐 SICUREZZA ATTIVA:`);
  console.log(`   Master Key: ${MASTER_KEY}`);
  console.log(`   Slave Key:  ${SLAVE_KEY}`);
  console.log(`💡 LOGICA COMPLETA: Pendenti + Trade Fillati + Chiusure Trade + Autenticazione Slave`);
});

// Pulizia automatica eventi vecchi ogni 6 ore
setInterval(() => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const before = recentEvents.length;
  recentEvents = recentEvents.filter(event => event.timestamp > cutoff);
  
  if (recentEvents.length !== before) {
    console.log(`🧹 Pulizia automatica: rimossi ${before - recentEvents.length} eventi vecchi`);
  }
  
  // Pulisci anche slave disconnessi
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const slavesBefore = connectedSlaves.size;
  connectedSlaves.forEach((data, slaveId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedSlaves.delete(slaveId);
    }
  });
  
  if (connectedSlaves.size !== slavesBefore) {
    console.log(`🧹 Pulizia slave disconnessi: rimossi ${slavesBefore - connectedSlaves.size} slave inattivi`);
  }
}, 6 * 60 * 60 * 1000);
