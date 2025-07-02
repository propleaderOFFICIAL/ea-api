const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let openTrades = new Map();      // ticket -> trade dati eseguiti
let pendingOrders = new Map();   // ticket -> dati ordini pendenti
let filledOrders = new Map();    // ticket pendente -> evento filled
let recentCloses = [];           // segnali di chiusura/cancellazione recenti
let masterAccountInfo = {};      // ultima informazione account Master
const MASTER_KEY = "master_secret_key_2024";

// Funzione per aggiornare informazioni account Master
function updateMasterAccountInfo(accountData) {
  if (accountData && typeof accountData === 'object') {
    masterAccountInfo = {
      ...accountData,
      lastUpdated: new Date()
    };
    console.log(`💰 Account Master aggiornato: Balance: ${accountData.balance}, Equity: ${accountData.equity}, Profit: ${accountData.profit}`);
  }
}

//+------------------------------------------------------------------+
//| ENDPOINT 1: Health Check                                        |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    time: new Date(),
    openTrades: openTrades.size,
    pendingOrders: pendingOrders.size,
    recentCloses: recentCloses.length,
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

  if (action === 'open') {
    // Trade aperto
    const signal = { signalType: 'trade', action, ticket, symbol, type, lots, price, sl, tp, time, comment, account, timestamp: new Date() };
    openTrades.set(ticket, signal);
    if (account) updateMasterAccountInfo(account);
    console.log(`🟢 TRADE APERTO - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${openTrades.size})`);

  } else if (action === 'pending') {
    // Ordine pendente
    const signal = {
      signalType: 'pending', action, ticket, symbol, type, lots, price, sl, tp, time, comment,
      expiration, activationprice, barsFromPlacement: barsFromPlacement || 0,
      timeframe: timeframe || 0, timeframeName: timeframeName || 'Unknown', account, timestamp: new Date()
    };
    pendingOrders.set(parseInt(ticket), signal);
    if (account) updateMasterAccountInfo(account);
    console.log(`🟡 ORDINE PENDENTE - Ticket: ${ticket}`);

  } else if (action === 'activated') {
    // Pendente attivato -> filled
    const pTicket = parseInt(pendingTicket);
    if (pendingOrders.has(pTicket)) {
      const pendingOrder = pendingOrders.get(pTicket);
      pendingOrders.delete(pTicket);
      const filledData = {
        signalType: 'filled', pendingTicket: pTicket, marketTicket: ticket,
        symbol: pendingOrder.symbol, fillPrice: price, fillTime: time, timestamp: new Date()
      };
      filledOrders.set(pTicket, filledData);
      if (account) updateMasterAccountInfo(account);
      console.log(`🔵 PENDENTE ESEGUITO - Pendente #${pTicket} -> Mercato #${ticket} @ ${price}`);
    } else {
      console.warn(`⚠️ 'activated' per pendente non tracciato: #${pendingTicket}`);
    }

  } else if (action === 'modify') {
    // Modifica ordine pendente
    if (pendingOrders.has(ticket)) {
      const existing = pendingOrders.get(ticket);
      const updated = { ...existing, lots, price, sl, tp, expiration,
        barsFromPlacement: barsFromPlacement || existing.barsFromPlacement,
        timeframe: timeframe || existing.timeframe,
        timeframeName: timeframeName || existing.timeframeName,
        account, modified: true, timestamp: new Date()
      };
      pendingOrders.set(ticket, updated);
      recentCloses.push({ signalType:'modify', action:'modify', ticket, symbol, price, sl, tp, expiration, barsFromPlacement, timeframe, timeframeName, account, timestamp: new Date() });
      if (account) updateMasterAccountInfo(account);
      console.log(`🔄 ORDINE MODIFICATO - Ticket: ${ticket} @ ${price}`);
    }

  } else if (action === 'close') {
    // Trade chiuso
    if (openTrades.has(ticket)) {
      openTrades.delete(ticket);
      recentCloses.push({ signalType:'close', action:'close', ticket, closeprice, closetime, profit, account, timestamp: new Date() });
      if (account) updateMasterAccountInfo(account);
      console.log(`🔴 TRADE CHIUSO - Ticket: ${ticket} @ ${closeprice}`);
    }

  } else if (action === 'cancel') {
    // Ordine cancellato
    const t = parseInt(ticket);
    if (pendingOrders.has(t)) {
      pendingOrders.delete(t);
      recentCloses.push({ signalType:'cancel', action:'cancel', ticket, canceltime: time, account, timestamp: new Date() });
      if (account) updateMasterAccountInfo(account);
      console.log(`❌ ORDINE CANCELLATO - Ticket: ${ticket}`);
    }
  }

  // Mantieni ultimi 50 eventi
  if (recentCloses.length > 50) recentCloses = recentCloses.slice(-50);
  res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Client get signals                                   |
//+------------------------------------------------------------------+
app.get('/api/getsignals', (req, res) => {
  const { lastsync } = req.query;
  const response = { openTrades: [], pendingOrders: [], filledOrders: [], recentActions: [], masterAccount: masterAccountInfo };
  openTrades.forEach(s => response.openTrades.push(s));
  pendingOrders.forEach(s => response.pendingOrders.push(s));
  filledOrders.forEach(s => response.filledOrders.push(s));
  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentActions = recentCloses.filter(a => a.timestamp > syncTime);
  } else {
    response.recentActions = recentCloses;
  }
  console.log(`📤 Segnali: open=${response.openTrades.length}, pending=${response.pendingOrders.length}, filled=${response.filledOrders.length}, actions=${response.recentActions.length}`);
  if (filledOrders.size > 0) filledOrders.clear();
  res.json({ ...response, serverTime: Date.now() });
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Statistiche                                         |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  const openArr = Array.from(openTrades.values());
  const pendArr = Array.from(pendingOrders.values());
  const stats = {};
  openArr.forEach(t => {
    stats[t.symbol] = stats[t.symbol] || { openTrades:0, pendingOrders:0, buy:0, sell:0 };
    stats[t.symbol].openTrades++;
    if (t.type === 0) stats[t.symbol].buy++;
    if (t.type === 1) stats[t.symbol].sell++;
  });
  pendArr.forEach(o => {
    stats[o.symbol] = stats[o.symbol] || { openTrades:0, pendingOrders:0, buy:0, sell:0, timeframes:[] };
    stats[o.symbol].pendingOrders++;
    if (o.timeframeName && !stats[o.symbol].timeframes.includes(o.timeframeName))
      stats[o.symbol].timeframes.push(o.timeframeName);
  });
  res.json({
    summary: { openTrades: openTrades.size, pendingOrders: pendingOrders.size, recentActions: recentCloses.length },
    symbolBreakdown: stats,
    recentActions: recentCloses.slice(-10),
    serverUptime: process.uptime(),
    lastActivity: openArr.length||pendArr.length ? Math.max(...openArr.map(t=>new Date(t.timestamp)), ...pendArr.map(p=>new Date(p.timestamp))) : null
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Reset completo (solo test)                          |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
  if (req.body.masterkey !== MASTER_KEY) return res.status(401).json({ error:'Unauthorized' });
  openTrades.clear(); pendingOrders.clear(); recentCloses = [];
  console.log('🧹 RESET COMPLETO');
  res.json({ status:'success', message:'Complete reset performed' });
});

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 EA Copy Trading API avviata su port ${PORT}`);
});

// Pulizia ogni 6 ore
setInterval(() => {
  const cutoff = new Date(Date.now() - 6*60*60*1000);
  const before = recentCloses.length;
  recentCloses = recentCloses.filter(a => a.timestamp > cutoff);
  if (recentCloses.length !== before)
    console.log(`🧹 Rimossi ${before - recentCloses.length} eventi vecchi`);
}, 6*60*60*1000);
