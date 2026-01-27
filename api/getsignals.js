const redis = require('./lib/redis');
const { authenticateSlave, getClientInfo } = require('./lib/auth');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Autenticazione
  if (!authenticateSlave(req)) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid slave key required' 
    });
  }
  
  try {
    // Traccia slave connesso
    const clientInfo = getClientInfo(req);
    const slaveId = clientInfo.ip + '_' + clientInfo.userAgent;
    await redis.trackSlave(slaveId, clientInfo);
    
    const { lastsync } = req.query;
    
    // Leggi tutti i dati necessari
    const [pendingOrders, filledTrades, count, resetInfo, slaveConfig, masterAccount] = await Promise.all([
      redis.getPendingOrders(),
      redis.getFilledTrades(),
      redis.getTradeCount(),
      redis.getResetInfo(),
      redis.getSlaveConfig(),
      redis.getMasterAccount()
    ]);
    
    // Recent events con filtro opzionale
    let recentEvents;
    if (lastsync) {
      recentEvents = await redis.getRecentEventsAfterSync(lastsync);
    } else {
      recentEvents = await redis.getRecentEvents();
    }
    
    const response = {
      pendingOrders: Object.values(pendingOrders),
      filledTrades: Object.values(filledTrades),
      recentEvents: recentEvents,
      masterAccount: masterAccount,
      serverTime: Date.now(),
      tradeCount: {
        pendingOrders: count.pendingOrders,
        filledTrades: count.filledTrades,
        totalTrades: count.totalTrades
      },
      resetInfo: {
        isReset: resetInfo.isReset,
        resetTimestamp: resetInfo.resetTimestamp
      },
      slaveConfig: {
        autoCloseFilledTrades: slaveConfig.autoCloseFilledTrades,
        lastUpdate: slaveConfig.lastUpdate
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('GetSignals error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
