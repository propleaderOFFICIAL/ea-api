const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let pendingOrders = new Map();
let filledTrades = new Map();
let recentEvents = [];
let masterAccountInfo = {};  // ← Solo dati account, SENZA slaveAutoCloseFilledTrades
let connectedSlaves = new Map();

// 🔥 VARIABILE SEPARATA PER LA CONFIGURAZIONE SLAVE (FIX PRINCIPALE)
let slaveConfig = {
  autoCloseFilledTrades: false,
  lastUpdate: null
};

// Flag di reset
let isReset = false;
let resetTimestamp = null;

// Broker time
let masterBrokerTime = null;
let lastMasterBrokerUpdate = null;

// Chiavi di sicurezza
const MASTER_KEY = "master_secret_key_2024";
const SLAVE_KEY = "slave_access_key_2025_08";

//+------------------------------------------------------------------+
//| Middleware per autenticazione Slave                              |
//+------------------------------------------------------------------+
function authenticateSlave(req, res, next) {
  const { slavekey } = req.query;
  
  if (!slavekey || slavekey !== SLAVE_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid slave key required' 
    });
  }
  
  const slaveId = req.ip + '_' + (req.headers['user-agent'] || 'unknown');
  connectedSlaves.set(slaveId, {
    lastAccess: new Date(),
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  next();
}

//+------------------------------------------------------------------+
//| 🔥 FUNZIONE CORRETTA: Non tocca più slaveConfig                  |
//+------------------------------------------------------------------+
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
//| Conta trades                                                      |
//+------------------------------------------------------------------+
function getTradeCount() {
  return {
    pendingOrders: pendingOrders.size,
    filledTrades: filledTrades.size,
    totalTrades: pendingOrders.size + filledTrades.size
  };
}

//+------------------------------------------------------------------+
//| Gestisce flag reset                                              |
//+------------------------------------------------------------------+
function setResetFlag(value, reason = '') {
  const wasReset = isReset;
  isReset = value;
  
  if (value) {
    resetTimestamp = new Date();
    console.log(`🚨 RESET FLAG ATTIVATO: ${reason}`);
  } else {
    if (wasReset) {
      console.log(`✅ RESET FLAG DISATTIVATO: ${reason}`);
    }
  }
}

//+------------------------------------------------------------------+
//| ENDPOINT: Contatore Trades                                       |
//+------------------------------------------------------------------+
app.get('/api/tradecount', authenticateSlave, (req, res) => {
  const count = getTradeCount();
  
  console.log(`📊 CONTATORE: Pendenti=${count.pendingOrders}, Fillati=${count.filledTrades}, Reset=${isReset}`);
  
  res.json({
    pendingOrders: count.pendingOrders,
    filledTrades: count.filledTrades,
    totalTrades: count.totalTrades,
    isReset: isReset,
    resetTimestamp: resetTimestamp,
    serverTime: Date.now(),
    status: 'success'
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Health Check                                           |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
  const count = getTradeCount();
  
  res.json({
    status: 'online',
    time: new Date(),
    pendingOrders: count.pendingOrders,
    filledTrades: count.filledTrades,
    totalTrades: count.totalTrades,
    isReset: isReset,
    resetTimestamp: resetTimestamp,
    recentEvents: recentEvents.length,
    connectedSlaves: connectedSlaves.size,
    masterAccount: masterAccountInfo.number || 'N/A',
    slaveAutoClose: slaveConfig.autoCloseFilledTrades
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Master invia segnali                                   |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
  const {
    masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
    expiration, account, barsFromPlacement, timeframe, timeframeName, barTimestamp,
    openPrice, closePrice, openTime, closeTime, profit, swap, commission
  } = req.body;

  if (masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date();
  const ticketNum = parseInt(ticket);

  // Disattiva reset se arriva un segnale di trading
  if (action === 'pending' || action === 'modify' || action === 'filled') {
    if (isReset) {
      setResetFlag(false, `Master ha inviato ${action} per ticket #${ticket}`);
    }
  }

  if (action === 'pending') {
    if (filledTrades.has(ticketNum)) {
      console.log(`⚠️ PENDENTE GIÀ FILLATO: #${ticket}`);
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
      barTimestamp: barTimestamp || null,
      timestamp
    };
    
    pendingOrders.set(ticketNum, pendingOrder);
    if (account) updateMasterAccountInfo(account);

    const count = getTradeCount();
    console.log(`🟡 PENDENTE #${ticket} ${symbol} @ ${price} (Tot: ${count.totalTrades}, AutoClose: ${slaveConfig.autoCloseFilledTrades})`);

  } else if (action === 'modify') {
    if (filledTrades.has(ticketNum)) {
      console.log(`⚠️ MODIFY IGNORATO: #${ticket} già fillato`);
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
        barTimestamp: barTimestamp || existing.barTimestamp,
        modified: true,
        timestamp
      };
      
      pendingOrders.set(ticketNum, updated);
      
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
        barTimestamp,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`🔄 MODIFICATO #${ticket} @ ${price}`);
    }

  } else if (action === 'silentBarsUpdate') {
    if (pendingOrders.has(ticketNum)) {
      const existing = pendingOrders.get(ticketNum);
      const updated = {
        ...existing,
        barsFromPlacement: barsFromPlacement,
        timeframe: timeframe || existing.timeframe,
        timeframeName: timeframeName || existing.timeframeName,
        barTimestamp: barTimestamp || existing.barTimestamp,
        lastBarsUpdate: timestamp
      };
      
      pendingOrders.set(ticketNum, updated);
      console.log(`📊 BARRE AGGIORNATE #${ticket} -> ${barsFromPlacement}`);
    }

    if (account) updateMasterAccountInfo(account);

  } else if (action === 'filled') {
    if (pendingOrders.has(ticketNum)) {
      const originalPending = pendingOrders.get(ticketNum);
      pendingOrders.delete(ticketNum);
      
      const filledTrade = {
        ...originalPending,
        signalType: 'filled',
        originalTicket: ticketNum,
        filledTime: time,
        timestamp
      };
      
      filledTrades.set(ticketNum, filledTrade);
      
      recentEvents = recentEvents.filter(event => event.ticket !== ticketNum);
      
      const count = getTradeCount();
      console.log(`🔵 FILLATO #${ticket} ${originalPending.symbol} (Tot: ${count.totalTrades})`);
    }

    if (account) updateMasterAccountInfo(account);

  } else if (action === 'trade_closed') {
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
    
    if (filledTrades.has(ticketNum)) {
      filledTrades.delete(ticketNum);
      console.log(`🔴 TRADE CHIUSO #${ticket} ${symbol} P:${profit} (AutoClose: ${slaveConfig.autoCloseFilledTrades})`);
    }
    
    recentEvents.push(closedTrade);
    if (account) updateMasterAccountInfo(account);

  } else if (action === 'cancel') {
    if (pendingOrders.has(ticketNum)) {
      const cancelledOrder = pendingOrders.get(ticketNum);
      pendingOrders.delete(ticketNum);
      
      recentEvents = recentEvents.filter(event => event.ticket !== ticketNum);
      
      recentEvents.push({
        signalType: 'cancel',
        action: 'cancel',
        ticket: ticketNum,
        symbol: cancelledOrder.symbol,
        canceltime: time,
        timestamp
      });
      
      if (account) updateMasterAccountInfo(account);
      console.log(`❌ CANCELLATO #${ticket}`);
    }
  }

  // Mantieni ultimi 100 eventi
  if (recentEvents.length > 100) {
    recentEvents = recentEvents.slice(-100);
  }

  res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Get signals (CON SLAVE CONFIG SEPARATA)               |
//+------------------------------------------------------------------+
app.get('/api/getsignals', authenticateSlave, (req, res) => {
  const { lastsync } = req.query;
  const count = getTradeCount();
  
  const response = {
    pendingOrders: [],
    filledTrades: [],
    recentEvents: [],
    masterAccount: masterAccountInfo,
    serverTime: Date.now(),
    tradeCount: {
      pendingOrders: count.pendingOrders,
      filledTrades: count.filledTrades,
      totalTrades: count.totalTrades
    },
    resetInfo: {
      isReset: isReset,
      resetTimestamp: resetTimestamp
    },
    // 🔥 USA LA VARIABILE SEPARATA - FIX PRINCIPALE
    slaveConfig: {
      autoCloseFilledTrades: slaveConfig.autoCloseFilledTrades,
      lastUpdate: slaveConfig.lastUpdate
    }
  };

  pendingOrders.forEach(order => response.pendingOrders.push(order));
  filledTrades.forEach(trade => response.filledTrades.push(trade));

  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentEvents = recentEvents.filter(event => event.timestamp > syncTime);
  } else {
    response.recentEvents = recentEvents;
  }
  
  console.log(`📤 Segnali a SLAVE: pending=${response.pendingOrders.length}, filled=${response.filledTrades.length}, events=${response.recentEvents.length}, autoClose=${response.slaveConfig.autoCloseFilledTrades}`);

  res.json(response);
});

//+------------------------------------------------------------------+
//| ENDPOINT: Slave notifica esecuzione                              |
//+------------------------------------------------------------------+
app.post('/api/slave-filled', authenticateSlave, (req, res) => {
  const { ticket } = req.body;
  const ticketNum = parseInt(ticket);
  
  if (filledTrades.has(ticketNum)) {
    filledTrades.delete(ticketNum);
    const count = getTradeCount();
    console.log(`✅ SLAVE CONFERMA ESECUZIONE: #${ticket} (Tot: ${count.totalTrades})`);
    res.json({ status: 'confirmed' });
  } else {
    console.warn(`⚠️ Slave conferma per ticket non fillato: #${ticket}`);
    res.json({ status: 'not_found' });
  }
});

//+------------------------------------------------------------------+
//| ENDPOINT: Statistiche dettagliate                                |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  const count = getTradeCount();
  const stats = {};
  
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

  // Pulisci slave disconnessi
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  connectedSlaves.forEach((data, slaveId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedSlaves.delete(slaveId);
    }
  });

  res.json({
    summary: {
      pendingOrders: count.pendingOrders,
      filledTrades: count.filledTrades,
      totalTrades: count.totalTrades,
      isReset: isReset,
      resetTimestamp: resetTimestamp,
      recentEvents: recentEvents.length,
      connectedSlaves: connectedSlaves.size
    },
    symbolBreakdown: stats,
    recentEvents: recentEvents.slice(-10),
    masterAccount: masterAccountInfo,
    slaveConfig: slaveConfig,
    connectedSlaves: Array.from(connectedSlaves.entries()).map(([id, data]) => ({
      id: id.substr(0, 20) + '...',
      lastAccess: data.lastAccess,
      ip: data.ip
    })),
    serverUptime: process.uptime()
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Reset completo                                         |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  setResetFlag(true, 'Master ha richiesto reset completo');

  pendingOrders.clear();
  filledTrades.clear();
  recentEvents = [];
  masterAccountInfo = {};
  connectedSlaves.clear();

  console.log('🧹 RESET COMPLETO');
  res.json({ 
    status: 'success', 
    message: 'Complete reset performed',
    isReset: isReset,
    resetTimestamp: resetTimestamp
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Debug                                                  |
//+------------------------------------------------------------------+
app.get('/api/debug', (req, res) => {
  const count = getTradeCount();
  
  res.json({
    tradeCount: count,
    resetInfo: {
      isReset: isReset,
      resetTimestamp: resetTimestamp
    },
    slaveConfig: slaveConfig,
    pendingOrders: Object.fromEntries(pendingOrders),
    filledTrades: Object.fromEntries(filledTrades),
    recentEvents,
    masterAccount: masterAccountInfo,
    connectedSlaves: Object.fromEntries(connectedSlaves)
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Verifica chiave slave                                  |
//+------------------------------------------------------------------+
app.post('/api/verify-slave', (req, res) => {
  const { slavekey } = req.body;
  
  if (slavekey === SLAVE_KEY) {
    const count = getTradeCount();
    res.json({ 
      status: 'authorized',
      message: 'Slave key valid',
      serverTime: Date.now(),
      tradeCount: count,
      resetInfo: {
        isReset: isReset,
        resetTimestamp: resetTimestamp
      }
    });
  } else {
    res.status(401).json({ 
      status: 'unauthorized',
      message: 'Invalid slave key'
    });
  }
});

//+------------------------------------------------------------------+
//| ENDPOINT: Reset flag manuale                                     |
//+------------------------------------------------------------------+
app.post('/api/reset-flag', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { value, reason } = req.body;
  
  setResetFlag(value === true, reason || 'Reset flag manuale');
  
  res.json({
    status: 'success',
    isReset: isReset,
    resetTimestamp: resetTimestamp,
    message: `Reset flag impostato a ${isReset}`
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT: Broker time + Config Slave (CORRETTO)                  |
//+------------------------------------------------------------------+
app.post('/api/broker-time', (req, res) => {
  const { masterkey, brokerTime, slaveAutoCloseFilledTrades } = req.body;

  if (masterkey !== MASTER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (brokerTime && typeof brokerTime === 'string') {
    masterBrokerTime = brokerTime;
    lastMasterBrokerUpdate = new Date();
    
    // 🔥 SALVA NELLA VARIABILE SEPARATA - FIX PRINCIPALE
    if (typeof slaveAutoCloseFilledTrades === 'boolean') {
      slaveConfig.autoCloseFilledTrades = slaveAutoCloseFilledTrades;
      slaveConfig.lastUpdate = new Date();
      console.log(`⚙️ Config Slave aggiornata: AutoClose=${slaveAutoCloseFilledTrades}`);
    }
    
    console.log(`🕐 Orario Broker Master: ${brokerTime}`);
    
    res.json({ 
      status: 'success',
      brokerTime: masterBrokerTime,
      slaveAutoCloseFilledTrades: slaveConfig.autoCloseFilledTrades,
      serverTime: Date.now()
    });
  } else {
    res.status(400).json({ 
      error: 'Invalid broker time',
      message: 'brokerTime field is required'
    });
  }
});

//+------------------------------------------------------------------+
//| ENDPOINT: Get broker time                                        |
//+------------------------------------------------------------------+
app.get('/api/broker-time', (req, res) => {
  res.json({
    brokerTime: masterBrokerTime,
    lastUpdate: lastMasterBrokerUpdate,
    serverTime: Date.now(),
    status: masterBrokerTime ? 'available' : 'not_synced'
  });
});

//+------------------------------------------------------------------+
//| Avvia server                                                     |
//+------------------------------------------------------------------+
app.listen(PORT, () => {
  console.log(`🚀 EA Advanced Pending API v8.0 (FIXED) avviata su port ${PORT}`);
  console.log(`📋 Endpoints disponibili:`);
  console.log(`   GET  /api/health           - Health check`);
  console.log(`   POST /api/signals          - Ricevi segnali dal Master`);
  console.log(`   GET  /api/getsignals       - Ottieni segnali per Slave (AUTH)`);
  console.log(`   GET  /api/tradecount       - Contatore trades (AUTH)`);
  console.log(`   POST /api/slave-filled     - Slave notifica esecuzione (AUTH)`);
  console.log(`   POST /api/broker-time      - Aggiorna orario broker + Config Slave`);
  console.log(`   GET  /api/broker-time      - Leggi orario broker`);
  console.log(`   GET  /api/stats            - Statistiche dettagliate`);
  console.log(`   POST /api/reset            - Reset completo (ATTIVA FLAG)`);
  console.log(`   POST /api/reset-flag       - Reset manuale del flag`);
  console.log(`   GET  /api/debug            - Debug stato interno`);
  console.log(`   POST /api/verify-slave     - Verifica chiave slave`);
  console.log(`🔐 SICUREZZA ATTIVA:`);
  console.log(`   Master Key: ${MASTER_KEY}`);
  console.log(`   Slave Key:  ${SLAVE_KEY}`);
  console.log(`🔧 FIX APPLICATO: slaveConfig separato da masterAccountInfo`);
  console.log(`💡 LOGICA: Pendenti + Fillati + Reset Flag + Slave Config INDIPENDENTE`);
});

//+------------------------------------------------------------------+
//| Pulizia automatica periodica                                     |
//+------------------------------------------------------------------+
setInterval(() => {
  // 1. Pulizia remoteTrades (ogni 10 secondi)
  const now = new Date();
  const beforeTrades = remoteTrades.length;
  remoteTrades = remoteTrades.filter(t => !t.executed && t.expires > now);
  
  if (remoteTrades.length !== beforeTrades) {
    console.log(`🧹 Cleanup remoteTrades: ${beforeTrades} -> ${remoteTrades.length}`);
  }
}, 10000);

setInterval(() => {
  // 2. Pulizia recentCommands (ogni 6 ore)
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const before = recentCommands.length;
  recentCommands = recentCommands.filter(cmd => cmd.timestamp > cutoff);
  
  if (recentCommands.length !== before) {
    console.log(`🧹 Pulizia comandi vecchi: rimossi ${before - recentCommands.length}`);
  }
  
  // 3. Pulizia bot inattivi
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const botsBefore = connectedBots.size;
  connectedBots.forEach((data, botId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedBots.delete(botId);
    }
  });
  
  if (connectedBots.size !== botsBefore) {
    console.log(`🧹 Pulizia bot disconnessi: rimossi ${botsBefore - connectedBots.size}`);
  }
}, 6 * 60 * 60 * 1000);
