const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let openTrades = new Map();      // ticket -> trade data (trade eseguiti)
let pendingOrders = new Map();   // ticket -> order data (ordini pendenti)
let recentCloses = [];           // segnali di chiusura/cancellazione recenti
const MASTER_KEY = "master_secret_key_2024";

//+------------------------------------------------------------------+
//| ENDPOINT 1: Health Check                                        |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        time: new Date(),
        openTrades: openTrades.size,
        pendingOrders: pendingOrders.size,
        recentCloses: recentCloses.length
    });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Master invia segnali                                |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
    const { 
        masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
        closeprice, closetime, expiration, activationprice
    } = req.body;
    
    // Verifica chiave master
    if (masterkey !== MASTER_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (action === "open") {
        // Trade aperto (eseguito)
        const signal = {
            signalType: "trade",
            action: "open",
            ticket: ticket,
            symbol: symbol,
            type: type,           // 0=BUY, 1=SELL
            lots: lots,
            price: price,         // Prezzo di esecuzione
            sl: sl,
            tp: tp,
            time: time,
            comment: comment,
            timestamp: new Date()
        };
        
        openTrades.set(ticket, signal);
        console.log(`🟢 TRADE APERTO - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${openTrades.size})`);
        
    } else if (action === "pending") {
        // Ordine pendente (in attesa)
        const signal = {
            signalType: "pending",
            action: "pending",
            ticket: ticket,
            symbol: symbol,
            type: type,           // 2=BUYLIMIT, 3=SELLLIMIT, 4=BUYSTOP, 5=SELLSTOP
            lots: lots,
            price: price,         // Prezzo dell'ordine pendente
            sl: sl,
            tp: tp,
            time: time,
            comment: comment,
            expiration: expiration,      // Scadenza ordine (opzionale)
            activationprice: activationprice,  // Prezzo di attivazione (per stop orders)
            timestamp: new Date()
        };
        
        pendingOrders.set(ticket, signal);
        console.log(`🟡 ORDINE PENDENTE - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${pendingOrders.size})`);
        
    } else if (action === "activated") {
        // Ordine pendente che si è attivato -> diventa trade aperto
        if (pendingOrders.has(ticket)) {
            const pendingOrder = pendingOrders.get(ticket);
            pendingOrders.delete(ticket);
            
            // Crea trade aperto dalla pending
            const activatedTrade = {
                signalType: "trade",
                action: "open",
                ticket: ticket,
                symbol: pendingOrder.symbol,
                type: pendingOrder.type >= 4 ? pendingOrder.type - 4 : pendingOrder.type - 2, // Converte pending type a market type
                lots: pendingOrder.lots,
                price: price,         // Prezzo di attivazione effettivo
                sl: pendingOrder.sl,
                tp: pendingOrder.tp,
                time: time,
                comment: pendingOrder.comment,
                timestamp: new Date(),
                wasActivated: true
            };
            
            openTrades.set(ticket, activatedTrade);
            console.log(`🔵 ORDINE ATTIVATO - Ticket: ${ticket} ${pendingOrder.symbol} @ ${price}`);
        }
        
    } else if (action === "close") {
        // Trade chiuso
        if (openTrades.has(ticket)) {
            openTrades.delete(ticket);
            
            const closeSignal = {
                action: "close",
                signalType: "close",
                ticket: ticket,
                closeprice: closeprice,
                closetime: closetime,
                timestamp: new Date()
            };
            
            recentCloses.push(closeSignal);
            console.log(`🔴 TRADE CHIUSO - Ticket: ${ticket} @ ${closeprice}`);
        }
        
    } else if (action === "cancel") {
        // Ordine pendente cancellato
        if (pendingOrders.has(ticket)) {
            pendingOrders.delete(ticket);
            
            const cancelSignal = {
                action: "cancel",
                signalType: "cancel",
                ticket: ticket,
                canceltime: time,
                timestamp: new Date()
            };
            
            recentCloses.push(cancelSignal);
            console.log(`❌ ORDINE CANCELLATO - Ticket: ${ticket}`);
        }
    }
    
    // Mantieni solo ultimi 50 eventi di chiusura/cancellazione
    if (recentCloses.length > 50) {
        recentCloses = recentCloses.slice(-50);
    }
    
    res.json({ status: 'success' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Client richiede segnali                             |
//+------------------------------------------------------------------+
app.get('/api/getsignals', (req, res) => {
    const { lastsync } = req.query; // Timestamp ultima sincronizzazione client
    
    const response = {
        openTrades: [],
        pendingOrders: [],
        recentActions: []  // Chiusure e cancellazioni
    };
    
    // Invia TUTTI i trade attualmente aperti dal master
    openTrades.forEach((signal, ticket) => {
        response.openTrades.push(signal);
    });
    
    // Invia TUTTI gli ordini pendenti attivi dal master
    pendingOrders.forEach((signal, ticket) => {
        response.pendingOrders.push(signal);
    });
    
    // Invia azioni recenti (chiusure/cancellazioni)
    if (lastsync) {
        const syncTime = new Date(parseInt(lastsync));
        response.recentActions = recentCloses.filter(action => 
            action.timestamp > syncTime
        );
    } else {
        // Prima sincronizzazione - invia tutte le azioni recenti
        response.recentActions = recentCloses;
    }
    
    console.log(`📤 Segnali inviati: ${response.openTrades.length} trade aperti, ${response.pendingOrders.length} ordini pendenti, ${response.recentActions.length} azioni recenti`);
    
    res.json({
        ...response,
        serverTime: new Date().getTime() // Per prossima sincronizzazione
    });
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Statistiche dettagliate                            |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
    const openTradesArray = Array.from(openTrades.values());
    const pendingOrdersArray = Array.from(pendingOrders.values());
    
    // Statistiche per simbolo
    const symbolStats = {};
    
    // Conta trade aperti
    openTradesArray.forEach(trade => {
        if (!symbolStats[trade.symbol]) {
            symbolStats[trade.symbol] = { openTrades: 0, pendingOrders: 0, buy: 0, sell: 0 };
        }
        symbolStats[trade.symbol].openTrades++;
        if (trade.type === 0) symbolStats[trade.symbol].buy++;
        if (trade.type === 1) symbolStats[trade.symbol].sell++;
    });
    
    // Conta ordini pendenti
    pendingOrdersArray.forEach(order => {
        if (!symbolStats[order.symbol]) {
            symbolStats[order.symbol] = { openTrades: 0, pendingOrders: 0, buy: 0, sell: 0 };
        }
        symbolStats[order.symbol].pendingOrders++;
    });
    
    res.json({
        summary: {
            openTrades: openTrades.size,
            pendingOrders: pendingOrders.size,
            recentActions: recentCloses.length
        },
        symbolBreakdown: symbolStats,
        recentActions: recentCloses.slice(-10), // Ultimi 10 eventi
        serverUptime: process.uptime(),
        lastActivity: openTradesArray.length > 0 || pendingOrdersArray.length > 0 ? 
            Math.max(
                ...openTradesArray.map(t => new Date(t.timestamp).getTime()),
                ...pendingOrdersArray.map(p => new Date(p.timestamp).getTime())
            ) : null
    });
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Reset completo (solo per test)                     |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
    const { masterkey } = req.body;
    
    if (masterkey !== MASTER_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    openTrades.clear();
    pendingOrders.clear();
    recentCloses = [];
    
    console.log('🧹 RESET COMPLETO - Tutti i segnali cancellati');
    res.json({ status: 'success', message: 'Complete reset performed' });
});

// Avvia server
app.listen(PORT, () => {
    console.log(`🚀 EA Copy Trading API (Trade + Pending) avviata sulla porta ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📊 Statistiche: http://localhost:${PORT}/api/stats`);
    console.log(`📈 Segnali: http://localhost:${PORT}/api/getsignals`);
});

// Pulizia automatica ogni 6 ore - rimuove azioni molto vecchie
setInterval(() => {
    const sixHoursAgo = new Date(Date.now() - 6*60*60*1000);
    const beforeCount = recentCloses.length;
    recentCloses = recentCloses.filter(action => action.timestamp > sixHoursAgo);
    
    if (beforeCount !== recentCloses.length) {
        console.log(`🧹 Rimossi ${beforeCount - recentCloses.length} eventi vecchi`);
    }
}, 6*60*60*1000); // Ogni 6 ore
