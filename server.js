const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria - SOLO PENDENTI
let pendingOrders = new Map();       // ticket -> dati ordini pendenti (solo pendenti attivi)
let recentEvents = [];               // eventi recenti (cancel, modify)
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
    pendingOrders: pendingOrders.size,
    recentEvents: recentEvents.length,
    masterAccount: masterAccountInfo.number || 'N/A'
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Master invia segnali (SOLO PENDENTI)               |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
  const {
    masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
    expiration, account, barsFromPlacement, timeframe, timeframeName
  } = req.body;

  if (masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date();

  if (action === 'pending') {
    // Nuovo ordine pendente
    const pendingOrder = {
      signalType: 'pending',
      ticket: parseInt(ticket),
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
    
    pendingOrders.set(parseInt(ticket), pendingOrder);
    if (account) updateMasterAccountInfo(account);
    
    console.log(`🟡 ORDINE PENDENTE - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${pendingOrders.size})`);

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

  } else if (action === 'cancel') {
    // Ordine pendente cancellato manualmente dal Master
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
      console.log(`❌ ORDINE CANCELLATO - Ticket: ${ticket} (Pendenti rimasti: ${pendingOrders.size})`);
      
    } else {
      console.warn(`⚠️ Tentativo di cancellare pendente non esistente: #${ticket}`);
    }

  } else if (action === 'filled') {
    // Pendente eseguito -> RIMUOVI dal server (lo slave non lo vedrà più)
    const pTicket = parseInt(ticket);
    
    if (pendingOrders.has(pTicket)) {
      const filledOrder = pendingOrders.get(pTicket);
      pendingOrders.delete(pTicket);
      
      console.log(`🔵 PENDENTE ESEGUITO E RIMOSSO - Ticket: #${pTicket} ${filledOrder.symbol} @ ${price}`);
      console.log(`📊 Pendenti rimasti: ${pendingOrders.size}`);
      
    } else {
      console.warn(`⚠️ 'filled' per pendente non tracciato: #${pTicket}`);
    }

    // NON aggiungiamo eventi per 'filled' - il pendente semplicemente scompare
    if (account) updateMasterAccountInfo(account);
  }

  // Mantieni ultimi 50 eventi
  if (recentEvents.length > 50) {
    recentEvents = recentEvents.slice(-50);
  }

  res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Client get signals (SOLO PENDENTI)                  |
//+------------------------------------------------------------------+
app.get('/api/getsignals', (req, res) => {
  const { lastsync } = req.query;
  
  const response = {
    pendingOrders: [],
    recentEvents: [],
    masterAccount: masterAccountInfo,
    serverTime: Date.now()
  };

  // Converti Map in Array
  pendingOrders.forEach(order => response.pendingOrders.push(order));

  // Filtra eventi recenti se lastsync è specificato
  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentEvents = recentEvents.filter(event => event.timestamp > syncTime);
  } else {
    response.recentEvents = recentEvents;
  }

  console.log(`📤 Segnali inviati: pendingOrders=${response.pendingOrders.length}, recentEvents=${response.recentEvents.length}`);

  res.json(response);
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Statistiche dettagliate                             |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  const stats = {};
  
  // Analisi per simbolo
  pendingOrders.forEach(order => {
    if (!stats[order.symbol]) {
      stats[order.symbol] = { pendingOrders: 0, timeframes: [] };
    }
    stats[order.symbol].pendingOrders++;
    if (order.timeframeName && !stats[order.symbol].timeframes.includes(order.timeframeName)) {
      stats[order.symbol].timeframes.push(order.timeframeName);
    }
  });

  const pendingOrdersArray = Array.from(pendingOrders.values());
  
  const lastActivity = pendingOrdersArray
    .map(item => new Date(item.timestamp))
    .reduce((latest, current) => current > latest ? current : latest, new Date(0));

  res.json({
    summary: {
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
//| ENDPOINT 5: Reset completo                                      |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  pendingOrders.clear();
  recentEvents = [];
  masterAccountInfo = {};

  console.log('🧹 RESET COMPLETO - Tutti i pendenti cancellati');
  res.json({ status: 'success', message: 'Complete reset performed' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 6: Debug - Stato interno                               |
//+------------------------------------------------------------------+
app.get('/api/debug', (req, res) => {
  res.json({
    pendingOrders: Object.fromEntries(pendingOrders),
    recentEvents,
    masterAccount: masterAccountInfo
  });
});

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 EA Pending Orders API v3.0 avviata su port ${PORT}`);
  console.log(`📋 Endpoints disponibili:`);
  console.log(`   GET  /api/health     - Health check`);
  console.log(`   POST /api/signals    - Ricevi segnali pendenti dal Master`);
  console.log(`   GET  /api/getsignals - Ottieni pendenti per Slave`);
  console.log(`   GET  /api/stats      - Statistiche dettagliate`);
  console.log(`   POST /api/reset      - Reset completo`);
  console.log(`   GET  /api/debug      - Debug stato interno`);
  console.log(`💡 SOLO ORDINI PENDENTI - Nessun trade a mercato gestito`);
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
