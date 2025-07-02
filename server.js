const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let activeTrades = new Map();        // ticket -> trade dati (solo trade attualmente aperti)
let pendingOrders = new Map();       // ticket -> dati ordini pendenti (solo pendenti attivi)
let filledOrders = new Map();        // ticket pendente -> dati filled (temporaneo per notifica)
let recentEvents = [];               // eventi recenti (close, cancel, modify)
let masterAccountInfo = {};          // ultima informazione account Master
const MASTER_KEY = "master_secret_key_2024";

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
    activeTrades: activeTrades.size,
    pendingOrders: pendingOrders.size,
    recentEvents: recentEvents.length,
    masterAccount: masterAccountInfo.number || 'N/A'
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Master invia segnali                                |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
  const {
    masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
    closeprice, closetime, expiration, activationprice, profit, account,
    barsFromPlacement, timeframe, timeframeName, pendingTicket
  } = req.body;

  if (masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date();

  if (action === 'open') {
    // Nuovo trade aperto direttamente (non da pendente)
    const trade = {
      signalType: 'trade',
      ticket,
      symbol,
      type,
      lots,
      price,
      sl,
      tp,
      time,
      comment,
      timestamp
    };
    
    activeTrades.set(ticket, trade);
    if (account) updateMasterAccountInfo(account);
    
    console.log(`🟢 TRADE APERTO - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${activeTrades.size})`);

  } else if (action === 'pending') {
    // Nuovo ordine pendente
    const pendingOrder = {
      signalType: 'pending',
      ticket,
      symbol,
      type,
      lots,
      price,
      sl,
      tp,
      time,
      comment,
      expiration,
      activationprice,
      barsFromPlacement: barsFromPlacement || 0,
      timeframe: timeframe || 0,
      timeframeName: timeframeName || 'Unknown',
      timestamp
    };
    
    pendingOrders.set(parseInt(ticket), pendingOrder);
    if (account) updateMasterAccountInfo(account);
    
    console.log(`🟡 ORDINE PENDENTE - Ticket: ${ticket} ${symbol} @ ${price}`);

  } else if (action === 'filled') {
    // Pendente eseguito -> diventa trade attivo
    const pTicket = parseInt(pendingTicket);
    
    if (pendingOrders.has(pTicket)) {
      const originalPending = pendingOrders.get(pTicket);
      
      // RIMUOVI il pendente dagli ordini attivi
      pendingOrders.delete(pTicket);
      
      // AGGIUNGI il nuovo trade ai trade attivi
      const newTrade = {
        signalType: 'trade',
        ticket: parseInt(ticket),           // nuovo ticket del trade a mercato
        symbol,
        type,
        lots,
        price,                             // prezzo di fill
        sl,
        tp,
        time,
        comment,
        originatingPendingTicket: pTicket,  // riferimento al pendente originale
        timestamp
      };
      
      activeTrades.set(parseInt(ticket), newTrade);
      
      // NOTIFICA temporanea per gli slave
      const filledNotification = {
        signalType: 'filled',
        pendingTicket: pTicket,
        marketTicket: parseInt(ticket),
        symbol: originalPending.symbol,
        fillPrice: price,
        fillTime: time,
        timestamp
      };
      
      filledOrders.set(pTicket, filledNotification);
      
      if (account) updateMasterAccountInfo(account);
      
      console.log(`🔵 PENDENTE ESEGUITO - Pendente #${pTicket} -> Trade #${ticket} @ ${price}`);
      console.log(`📊 Pendenti rimasti: ${pendingOrders.size}, Trade attivi: ${activeTrades.size}`);
      
    } else {
      console.warn(`⚠️ 'filled' per pendente non tracciato: #${pendingTicket}`);
    }

  } else if (action === 'modify') {
    // Modifica ordine pendente
    const pTicket = parseInt(ticket);
    
    if (pendingOrders.has(pTicket)) {
      const existing = pendingOrders.get(pTicket);
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
      
      pendingOrders.set(pTicket, updated);
      
      // Aggiungi evento di modifica
      recentEvents.push({
        signalType: 'modify',
        action: 'modify',
        ticket: pTicket,
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
      console.log(`🔄 ORDINE MODIFICATO - Ticket: ${ticket} @ ${price}`);
      
    } else {
      console.warn(`⚠️ Tentativo di modificare pendente non esistente: #${ticket}`);
    }

  } else if (action === 'close') {
    // Trade chiuso
    const tTicket = parseInt(ticket);
    
    if (activeTrades.has(tTicket)) {
      const closedTrade = activeTrades.get(tTicket);
      activeTrades.delete(tTicket);
      
      // Aggiungi evento di chiusura
      recentEvents.push({
        signalType: 'close',
        action: 'close',
        ticket: tTicket,
        symbol: closedTrade.symbol,
        closeprice,
        closetime,
        profit,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`🔴 TRADE CHIUSO - Ticket: ${ticket} @ ${closeprice}, Profit: ${profit}`);
      
    } else {
      console.warn(`⚠️ Tentativo di chiudere trade non esistente: #${ticket}`);
    }

  } else if (action === 'cancel') {
    // Ordine pendente cancellato
    const pTicket = parseInt(ticket);
    
    if (pendingOrders.has(pTicket)) {
      const cancelledOrder = pendingOrders.get(pTicket);
      pendingOrders.delete(pTicket);
      
      // Aggiungi evento di cancellazione
      recentEvents.push({
        signalType: 'cancel',
        action: 'cancel',
        ticket: pTicket,
        symbol: cancelledOrder.symbol,
        canceltime: time,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`❌ ORDINE CANCELLATO - Ticket: ${ticket}`);
      
    } else {
      console.warn(`⚠️ Tentativo di cancellare pendente non esistente: #${ticket}`);
    }
  }

  // Mantieni ultimi 50 eventi
  if (recentEvents.length > 50) {
    recentEvents = recentEvents.slice(-50);
  }

  res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Client get signals                                   |
//+------------------------------------------------------------------+
app.get('/api/getsignals', (req, res) => {
  const { lastsync } = req.query;
  
  const response = {
    activeTrades: [],
    pendingOrders: [],
    filledOrders: [],
    recentEvents: [],
    masterAccount: masterAccountInfo,
    serverTime: Date.now()
  };

  // Converti Maps in Arrays
  activeTrades.forEach(trade => response.activeTrades.push(trade));
  pendingOrders.forEach(order => response.pendingOrders.push(order));
  filledOrders.forEach(filled => response.filledOrders.push(filled));

  // Filtra eventi recenti se lastsync è specificato
  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentEvents = recentEvents.filter(event => event.timestamp > syncTime);
  } else {
    response.recentEvents = recentEvents;
  }

  console.log(`📤 Segnali inviati: activeTrades=${response.activeTrades.length}, pendingOrders=${response.pendingOrders.length}, filledOrders=${response.filledOrders.length}, recentEvents=${response.recentEvents.length}`);

  // IMPORTANTE: Pulisci le notifiche filled dopo averle inviate
  if (filledOrders.size > 0) {
    console.log(`🧹 Pulizia ${filledOrders.size} notifiche filled`);
    filledOrders.clear();
  }

  res.json(response);
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Statistiche dettagliate                             |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  const stats = {};
  
  // Analisi per simbolo
  activeTrades.forEach(trade => {
    if (!stats[trade.symbol]) {
      stats[trade.symbol] = { activeTrades: 0, pendingOrders: 0, buy: 0, sell: 0 };
    }
    stats[trade.symbol].activeTrades++;
    if (trade.type === 0) stats[trade.symbol].buy++;
    if (trade.type === 1) stats[trade.symbol].sell++;
  });

  pendingOrders.forEach(order => {
    if (!stats[order.symbol]) {
      stats[order.symbol] = { activeTrades: 0, pendingOrders: 0, buy: 0, sell: 0, timeframes: [] };
    }
    stats[order.symbol].pendingOrders++;
    if (order.timeframeName && !stats[order.symbol].timeframes.includes(order.timeframeName)) {
      stats[order.symbol].timeframes.push(order.timeframeName);
    }
  });

  const activeTradesArray = Array.from(activeTrades.values());
  const pendingOrdersArray = Array.from(pendingOrders.values());
  
  const lastActivity = [...activeTradesArray, ...pendingOrdersArray]
    .map(item => new Date(item.timestamp))
    .reduce((latest, current) => current > latest ? current : latest, new Date(0));

  res.json({
    summary: {
      activeTrades: activeTrades.size,
      pendingOrders: pendingOrders.size,
      recentEvents: recentEvents.length
    },
    symbolBreakdown: stats,
    recentEvents: recentEvents.slice(-10),
    masterAccount: masterAccountInfo,
    serverUptime: process.uptime(),
    lastActivity: lastActivity > new Date(0) ? lastActivity : null
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Reset completo (solo test)                          |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  activeTrades.clear();
  pendingOrders.clear();
  filledOrders.clear();
  recentEvents = [];
  masterAccountInfo = {};

  console.log('🧹 RESET COMPLETO - Tutti i dati cancellati');
  res.json({ status: 'success', message: 'Complete reset performed' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 6: Debug - Stato interno                               |
//+------------------------------------------------------------------+
app.get('/api/debug', (req, res) => {
  res.json({
    activeTrades: Object.fromEntries(activeTrades),
    pendingOrders: Object.fromEntries(pendingOrders),
    filledOrders: Object.fromEntries(filledOrders),
    recentEvents,
    masterAccount: masterAccountInfo
  });
});

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 EA Copy Trading API v2.0 avviata su port ${PORT}`);
  console.log(`📋 Endpoints disponibili:`);
  console.log(`   GET  /api/health     - Health check`);
  console.log(`   POST /api/signals    - Ricevi segnali dal Master`);
  console.log(`   GET  /api/getsignals - Ottieni segnali per Slave`);
  console.log(`   GET  /api/stats      - Statistiche dettagliate`);
  console.log(`   POST /api/reset      - Reset completo (test)`);
  console.log(`   GET  /api/debug      - Debug stato interno`);
});

// Pulizia automatica eventi vecchi ogni 6 ore
setInterval(() => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const before = recentEvents.length;
  recentEvents = recentEvents.filter(event => event.timestamp > cutoff);
  
  if (recentEvents.length !== before) {
    console.log(`🧹 Pulizia automatica: rimossi ${before - recentEvents.length} eventi vecchi`);
  }
}, 6 * 60 * 60 * 1000);
