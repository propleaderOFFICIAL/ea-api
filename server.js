const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// ==================================================================
// Database in memoria
// ==================================================================
let openTrades = new Map();      // ticket -> trade data (trade eseguiti manualmente)
let pendingOrders = new Map();   // ticket -> order data (ordini pendenti attivi)
let filledOrders = new Map();    // NUOVO: ticket_pendente -> dati del trade fillato
let recentCloses = [];           // segnali di chiusura/cancellazione/modifica recenti
let masterAccountInfo = {};      // ultima informazione account Master
const MASTER_KEY = "master_secret_key_2024";

//+------------------------------------------------------------------+
//| ENDPOINT 1: Health Check                                         |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        time: new Date(),
        openTrades: openTrades.size,
        pendingOrders: pendingOrders.size,
        filledOrders: filledOrders.size, // Aggiunto per completezza
        recentCloses: recentCloses.length,
        masterAccount: masterAccountInfo.number || 'N/A'
    });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Master invia segnali                                 |
//+------------------------------------------------------------------+
app.post('/api/signals', (req, res) => {
    const { 
        masterkey, action, ticket, symbol, type, lots, price, sl, tp, time, comment,
        closeprice, closetime, expiration, profit, account, 
        barsFromPlacement, timeframe, timeframeName,
        pendingTicket // Campo chiave per l'attivazione
    } = req.body;
    
    // Verifica chiave master
    if (masterkey !== MASTER_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Azione: Nuovo trade manuale
    if (action === "open") {
        const signal = {
            signalType: "trade",
            action: "open",
            ticket: ticket,
            symbol: symbol,
            type: type,
            lots: lots,
            price: price,
            sl: sl,
            tp: tp,
            time: time,
            comment: comment,
            account: account,
            timestamp: new Date()
        };
        
        openTrades.set(ticket, signal);
        if (account) updateMasterAccountInfo(account);
        console.log(`🟢 TRADE APERTO - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${openTrades.size})`);
    
    // Azione: Nuovo ordine pendente
    } else if (action === "pending") {
        const signal = {
            signalType: "pending",
            action: "pending",
            ticket: ticket,
            symbol: symbol,
            type: type,
            lots: lots,
            price: price,
            sl: sl,
            tp: tp,
            time: time,
            comment: comment,
            expiration: expiration,
            barsFromPlacement: barsFromPlacement || 0,
            timeframe: timeframe || 0,
            timeframeName: timeframeName || "Unknown",
            account: account,
            timestamp: new Date()
        };
        
        pendingOrders.set(ticket, signal);
        if (account) updateMasterAccountInfo(account);
        console.log(`🟡 ORDINE PENDENTE - Ticket: ${ticket} ${symbol} @ ${price} (Totali: ${pendingOrders.size})`);

    // ==================================================================
    //| SEZIONE MODIFICATA: Gestione attivazione pendente               |
    // ==================================================================
    } else if (action === "activated") {
        if (pendingOrders.has(pendingTicket)) {
            // 1. Rimuovi l'ordine dalla lista dei pendenti
            const pendingOrder = pendingOrders.get(pendingTicket);
            pendingOrders.delete(pendingTicket);

            // 2. Registra l'evento nella nuova lista 'filledOrders'
            const filledData = {
                signalType: "filled",
                pendingTicket: pendingTicket, // Ticket del pendente originale
                marketTicket: ticket,       // Ticket del nuovo trade a mercato
                symbol: pendingOrder.symbol,
                fillPrice: price,           // Prezzo di esecuzione reale
                fillTime: time,
                timestamp: new Date()
            };
            filledOrders.set(pendingTicket, filledData);

            if (account) updateMasterAccountInfo(account);
            console.log(`🔵 PENDENTE ESEGUITO (FILLED) - Pendente #${pendingTicket} -> Mercato #${ticket} @ ${price}`);

        } else {
            console.warn(`⚠️ Ricevuto segnale 'activated' per un pendente non tracciato o già eseguito: #${pendingTicket}`);
        }

    // Azione: Modifica ordine pendente
    } else if (action === "modify") {
        if (pendingOrders.has(ticket)) {
            const existingOrder = pendingOrders.get(ticket);
            
            const updatedOrder = {
                ...existingOrder,
                lots: lots, price: price, sl: sl, tp: tp, expiration: expiration,
                barsFromPlacement: barsFromPlacement || existingOrder.barsFromPlacement,
                timeframe: timeframe || existingOrder.timeframe,
                timeframeName: timeframeName || existingOrder.timeframeName,
                account: account, timestamp: new Date(), modified: true
            };
            
            pendingOrders.set(ticket, updatedOrder);
            
            const modifyAction = {
                action: "modify", signalType: "modify", ticket: ticket, symbol: symbol,
                price: price, sl: sl, tp: tp, expiration: expiration,
                barsFromPlacement: barsFromPlacement || 0,
                timeframe: timeframe || 0,
                timeframeName: timeframeName || "Unknown",
                account: account, timestamp: new Date()
            };
            
            recentCloses.push(modifyAction);
            if (account) updateMasterAccountInfo(account);
            console.log(`🔄 ORDINE MODIFICATO - Ticket: ${ticket} ${updatedOrder.symbol} @ ${price}`);
        }
        
    // Azione: Chiusura trade
    } else if (action === "close") {
        if (openTrades.has(ticket)) {
            openTrades.delete(ticket);
            
            const closeSignal = {
                action: "close", signalType: "close", ticket: ticket,
                closeprice: closeprice, closetime: closetime, profit: profit,
                account: account, timestamp: new Date()
            };
            
            recentCloses.push(closeSignal);
            if (account) updateMasterAccountInfo(account);
            console.log(`🔴 TRADE CHIUSO - Ticket: ${ticket} @ ${closeprice} Profit: ${profit || 'N/A'}`);
        }
        
    // Azione: Cancellazione ordine pendente
    } else if (action === "cancel") {
        if (pendingOrders.has(ticket)) {
            pendingOrders.delete(ticket);
            
            const cancelSignal = {
                action: "cancel", signalType: "cancel", ticket: ticket,
                canceltime: time, account: account, timestamp: new Date()
            };
            
            recentCloses.push(cancelSignal);
            if (account) updateMasterAccountInfo(account);
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
//| ENDPOINT 3: Client richiede segnali                              |
//+------------------------------------------------------------------+
app.get('/api/getsignals', (req, res) => {
    const { lastsync } = req.query;

    const response = {
        openTrades: [],
        pendingOrders: [],
        filledOrders: [],   // NUOVO: invia la lista dei pendenti fillati
        recentActions: [],
        masterAccount: masterAccountInfo
    };

    // Invia TUTTI i trade attualmente aperti dal master
    openTrades.forEach((signal, ticket) => {
        response.openTrades.push(signal);
    });

    // Invia TUTTI gli ordini pendenti attivi dal master
    pendingOrders.forEach((signal, ticket) => {
        response.pendingOrders.push(signal);
    });

    // NUOVO: Invia tutti gli ordini fillati
    filledOrders.forEach((signal, ticket) => {
        response.filledOrders.push(signal);
    });
    
    // Invia azioni recenti (chiusure/cancellazioni/modifiche)
    if (lastsync) {
        const syncTime = new Date(parseInt(lastsync));
        response.recentActions = recentCloses.filter(action =>
            action.timestamp > syncTime
        );
    } else {
        response.recentActions = recentCloses;
    }

    console.log(`📤 Segnali inviati: ${response.openTrades.length} aperti, ${response.pendingOrders.length} pendenti, ${response.filledOrders.length} fillati, ${response.recentActions.length} azioni`);

    // Dopo che gli ordini fillati sono stati inviati una volta, si possono rimuovere per non inviarli più
    // Questo previene che gli slave tentino di cancellare ordini già cancellati
    filledOrders.clear();

    res.json({
        ...response,
        serverTime: new Date().getTime()
    });
});


//+------------------------------------------------------------------+
//| ENDPOINT 4: Statistiche dettagliate                              |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
    res.json({
        summary: {
            openTrades: openTrades.size,
            pendingOrders: pendingOrders.size,
            recentActions: recentCloses.length
        },
        // ... altre statistiche se necessario
    });
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Reset completo                                       |
//+------------------------------------------------------------------+
app.post('/api/reset', (req, res) => {
    const { masterkey } = req.body;
    
    if (masterkey !== MASTER_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    openTrades.clear();
    pendingOrders.clear();
    filledOrders.clear(); // Pulisci anche i fillati
    recentCloses = [];
    
    console.log('🧹 RESET COMPLETO - Tutti i segnali cancellati');
    res.json({ status: 'success', message: 'Complete reset performed' });
});

//+------------------------------------------------------------------+
//| Funzione per aggiornare informazioni account Master              |
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

// Avvia server
app.listen(PORT, () => {
    console.log(`🚀 EA Copy Trading API avviata sulla porta ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
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
