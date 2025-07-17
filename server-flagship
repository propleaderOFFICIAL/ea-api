const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurazione
app.use(cors());
app.use(bodyParser.json());

// Database in memoria
let currentTrend = {
  direction: 'NONE',           // BUY, SELL, ENTRAMBI, NONE
  isActive: false,             // true = start, false = stop
  forceClose: false,           // comando di chiusura forzata
  lastUpdate: null,
  controllerInfo: {}
};

let connectedBots = new Map();       // botKey -> ultimo accesso
let recentCommands = [];             // comandi recenti (trend_change, start_stop, force_close)
let controllerAccountInfo = {};      // ultima informazione account Controller

// Chiavi di sicurezza
const CONTROLLER_KEY = "controller_flagship_key_2025";
const BOT_KEY = "bot_flagship_access_2025_secure";

// Middleware per autenticazione Bot
function authenticateBot(req, res, next) {
  const { botkey } = req.query;
  
  if (!botkey || botkey !== BOT_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid bot key required' 
    });
  }
  
  // Registra accesso bot
  const botId = req.ip + '_' + (req.headers['user-agent'] || 'unknown');
  connectedBots.set(botId, {
    lastAccess: new Date(),
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  next();
}

// Funzione per aggiornare informazioni account Controller
function updateControllerAccountInfo(accountData) {
  if (accountData && typeof accountData === 'object') {
    controllerAccountInfo = {
      ...accountData,
      lastUpdated: new Date()
    };
    console.log(`💰 Account Controller aggiornato: Balance: ${accountData.balance}, Equity: ${accountData.equity}`);
  }
}

//+------------------------------------------------------------------+
//| ENDPOINT 1: Health Check                                        |
//+------------------------------------------------------------------+
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    time: new Date(),
    currentTrend: currentTrend.direction,
    isActive: currentTrend.isActive,
    forceClose: currentTrend.forceClose,
    connectedBots: connectedBots.size,
    recentCommands: recentCommands.length,
    controllerAccount: controllerAccountInfo.number || 'N/A'
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 2: Controller invia comandi                            |
//+------------------------------------------------------------------+
app.post('/api/commands', (req, res) => {
  const {
    controllerkey, action, trend, active, forceclose, account
  } = req.body;

  if (controllerkey !== CONTROLLER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timestamp = new Date();

  if (action === 'trend_change') {
    // Cambio direzione trend
    const validTrends = ['BUY', 'SELL', 'ENTRAMBI', 'NONE'];
    if (!validTrends.includes(trend)) {
      return res.status(400).json({ error: 'Invalid trend direction' });
    }

    const oldTrend = currentTrend.direction;
    currentTrend.direction = trend;
    currentTrend.lastUpdate = timestamp;

    // Aggiungi comando agli eventi recenti
    recentCommands.push({
      commandType: 'trend_change',
      action: 'trend_change',
      oldTrend,
      newTrend: trend,
      timestamp
    });

    if (account) updateControllerAccountInfo(account);
    console.log(`📈 TREND CAMBIATO: ${oldTrend} -> ${trend}`);

  } else if (action === 'start_stop') {
    // Avvio/stop EA
    const isStart = active === true || active === 'true';
    const oldStatus = currentTrend.isActive;
    currentTrend.isActive = isStart;
    currentTrend.lastUpdate = timestamp;

    // Aggiungi comando agli eventi recenti
    recentCommands.push({
      commandType: 'start_stop',
      action: 'start_stop',
      oldStatus,
      newStatus: isStart,
      command: isStart ? 'START' : 'STOP',
      timestamp
    });

    if (account) updateControllerAccountInfo(account);
    console.log(`🎮 EA ${isStart ? 'AVVIATO' : 'FERMATO'}`);

  } else if (action === 'force_close') {
    // Comando di chiusura forzata
    const shouldClose = forceclose === true || forceclose === 'true';
    currentTrend.forceClose = shouldClose;
    currentTrend.lastUpdate = timestamp;

    // Aggiungi comando agli eventi recenti
    recentCommands.push({
      commandType: 'force_close',
      action: 'force_close',
      forceClose: shouldClose,
      timestamp
    });

    if (account) updateControllerAccountInfo(account);
    console.log(`🔴 FORZA CHIUSURA: ${shouldClose ? 'ATTIVATO' : 'DISATTIVATO'}`);

    // Reset automatico del flag dopo 5 secondi
    if (shouldClose) {
      setTimeout(() => {
        currentTrend.forceClose = false;
        console.log(`🔄 FORZA CHIUSURA: Reset automatico`);
      }, 5000);
    }

  } else if (action === 'status_update') {
    // Aggiornamento completo dello stato
    const validTrends = ['BUY', 'SELL', 'ENTRAMBI', 'NONE'];
    
    if (trend && validTrends.includes(trend)) {
      currentTrend.direction = trend;
    }
    
    if (active !== undefined) {
      currentTrend.isActive = active === true || active === 'true';
    }
    
    if (forceclose !== undefined) {
      currentTrend.forceClose = forceclose === true || forceclose === 'true';
    }
    
    currentTrend.lastUpdate = timestamp;

    // Aggiungi comando agli eventi recenti
    recentCommands.push({
      commandType: 'status_update',
      action: 'status_update',
      trend: currentTrend.direction,
      active: currentTrend.isActive,
      forceClose: currentTrend.forceClose,
      timestamp
    });

    if (account) updateControllerAccountInfo(account);
    console.log(`🔄 STATO AGGIORNATO: Trend=${currentTrend.direction}, Active=${currentTrend.isActive}, ForceClose=${currentTrend.forceClose}`);
  }

  // Mantieni ultimi 50 comandi
  if (recentCommands.length > 50) {
    recentCommands = recentCommands.slice(-50);
  }

  res.json({ 
    status: 'success',
    currentState: {
      trend: currentTrend.direction,
      active: currentTrend.isActive,
      forceClose: currentTrend.forceClose,
      lastUpdate: currentTrend.lastUpdate
    }
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 3: Bot riceve comandi (CON AUTENTICAZIONE BOT)         |
//+------------------------------------------------------------------+
app.get('/api/getcommands', authenticateBot, (req, res) => {
  const { lastsync } = req.query;
  
  const response = {
    currentTrend: currentTrend,
    recentCommands: [],
    controllerAccount: controllerAccountInfo,
    serverTime: Date.now()
  };

  // Filtra comandi recenti se lastsync è specificato
  if (lastsync) {
    const syncTime = new Date(parseInt(lastsync));
    response.recentCommands = recentCommands.filter(cmd => cmd.timestamp > syncTime);
  } else {
    response.recentCommands = recentCommands;
  }

  console.log(`📤 Comandi inviati a BOT: trend=${currentTrend.direction}, active=${currentTrend.isActive}, forceClose=${currentTrend.forceClose}, recentCommands=${response.recentCommands.length}`);

  res.json(response);
});

//+------------------------------------------------------------------+
//| ENDPOINT 4: Bot notifica esecuzione comando (CON AUTH)          |
//+------------------------------------------------------------------+
app.post('/api/bot-confirm', authenticateBot, (req, res) => {
  const { commandType, status, message } = req.body;
  
  const confirmation = {
    commandType,
    status,
    message,
    timestamp: new Date()
  };

  // Aggiungi conferma agli eventi recenti
  recentCommands.push({
    commandType: 'bot_confirmation',
    action: 'bot_confirm',
    originalCommand: commandType,
    confirmationStatus: status,
    message,
    timestamp: new Date()
  });

  console.log(`✅ BOT CONFERMA: ${commandType} -> ${status} (${message || 'no message'})`);
  
  res.json({ status: 'confirmed' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 5: Statistiche dettagliate                             |
//+------------------------------------------------------------------+
app.get('/api/stats', (req, res) => {
  // Pulisci bot disconnessi (oltre 5 minuti)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  connectedBots.forEach((data, botId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedBots.delete(botId);
    }
  });

  // Statistiche comandi
  const commandStats = {};
  recentCommands.forEach(cmd => {
    const type = cmd.commandType || 'unknown';
    commandStats[type] = (commandStats[type] || 0) + 1;
  });

  res.json({
    summary: {
      currentTrend: currentTrend.direction,
      isActive: currentTrend.isActive,
      forceClose: currentTrend.forceClose,
      lastUpdate: currentTrend.lastUpdate,
      connectedBots: connectedBots.size,
      recentCommands: recentCommands.length
    },
    commandStats,
    recentCommands: recentCommands.slice(-10),
    controllerAccount: controllerAccountInfo,
    connectedBots: Array.from(connectedBots.entries()).map(([id, data]) => ({
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
  if (req.body.controllerkey !== CONTROLLER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  currentTrend = {
    direction: 'NONE',
    isActive: false,
    forceClose: false,
    lastUpdate: null,
    controllerInfo: {}
  };
  
  connectedBots.clear();
  recentCommands = [];
  controllerAccountInfo = {};

  console.log('🧹 RESET COMPLETO - Tutti i dati cancellati');
  res.json({ status: 'success', message: 'Complete reset performed' });
});

//+------------------------------------------------------------------+
//| ENDPOINT 7: Debug - Stato interno                               |
//+------------------------------------------------------------------+
app.get('/api/debug', (req, res) => {
  res.json({
    currentTrend,
    recentCommands,
    controllerAccount: controllerAccountInfo,
    connectedBots: Object.fromEntries(connectedBots)
  });
});

//+------------------------------------------------------------------+
//| ENDPOINT 8: Verifica chiave bot                                 |
//+------------------------------------------------------------------+
app.post('/api/verify-bot', (req, res) => {
  const { botkey } = req.body;
  
  if (botkey === BOT_KEY) {
    res.json({ 
      status: 'authorized',
      message: 'Bot key valid',
      serverTime: Date.now(),
      currentTrend: currentTrend
    });
  } else {
    res.status(401).json({ 
      status: 'unauthorized',
      message: 'Invalid bot key'
    });
  }
});

//+------------------------------------------------------------------+
//| ENDPOINT 9: Stato rapido trend                                  |
//+------------------------------------------------------------------+
app.get('/api/trend-status', authenticateBot, (req, res) => {
  res.json({
    trend: currentTrend.direction,
    active: currentTrend.isActive,
    forceClose: currentTrend.forceClose,
    lastUpdate: currentTrend.lastUpdate,
    serverTime: Date.now()
  });
});

// Avvia server
app.listen(PORT, () => {
  console.log(`🚀 Prop Leader - Flagship Trend Server v1.0 avviato su port ${PORT}`);
  console.log(`📋 Endpoints disponibili:`);
  console.log(`   GET  /api/health           - Health check`);
  console.log(`   POST /api/commands         - Ricevi comandi dal Controller`);
  console.log(`   GET  /api/getcommands      - Ottieni comandi per Bot (AUTH)`);
  console.log(`   POST /api/bot-confirm      - Bot conferma esecuzione (AUTH)`);
  console.log(`   GET  /api/stats            - Statistiche dettagliate`);
  console.log(`   GET  /api/trend-status     - Stato rapido trend (AUTH)`);
  console.log(`   POST /api/reset            - Reset completo`);
  console.log(`   GET  /api/debug            - Debug stato interno`);
  console.log(`   POST /api/verify-bot       - Verifica chiave bot`);
  console.log(`🔐 SICUREZZA ATTIVA:`);
  console.log(`   Controller Key: ${CONTROLLER_KEY}`);
  console.log(`   Bot Key:       ${BOT_KEY}`);
  console.log(`💡 LOGICA: Controllo Trend (BUY/SELL/ENTRAMBI) + Start/Stop + Force Close`);
  console.log(`🤖 Target Bot: Prop Leader - Flagship`);
});

// Pulizia automatica comandi vecchi ogni 6 ore
setInterval(() => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const before = recentCommands.length;
  recentCommands = recentCommands.filter(cmd => cmd.timestamp > cutoff);
  
  if (recentCommands.length !== before) {
    console.log(`🧹 Pulizia automatica: rimossi ${before - recentCommands.length} comandi vecchi`);
  }
  
  // Pulisci anche bot disconnessi
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const botsBefore = connectedBots.size;
  connectedBots.forEach((data, botId) => {
    if (data.lastAccess < fiveMinutesAgo) {
      connectedBots.delete(botId);
    }
  });
  
  if (connectedBots.size !== botsBefore) {
    console.log(`🧹 Pulizia bot disconnessi: rimossi ${botsBefore - connectedBots.size} bot inattivi`);
  }
}, 6 * 60 * 60 * 1000);
