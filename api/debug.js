const redis = require('./lib/redis');

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
  
  try {
    const [
      pendingOrders,
      filledTrades,
      recentEvents,
      count,
      resetInfo,
      slaveConfig,
      masterAccount,
      connectedSlaves
    ] = await Promise.all([
      redis.getPendingOrders(),
      redis.getFilledTrades(),
      redis.getRecentEvents(),
      redis.getTradeCount(),
      redis.getResetInfo(),
      redis.getSlaveConfig(),
      redis.getMasterAccount(),
      redis.getConnectedSlaves()
    ]);
    
    res.json({
      tradeCount: count,
      resetInfo: resetInfo,
      slaveConfig: slaveConfig,
      pendingOrders: pendingOrders,
      filledTrades: filledTrades,
      recentEvents: recentEvents,
      masterAccount: masterAccount,
      connectedSlaves: connectedSlaves,
      prefix: process.env.PREFIX || 'default_',
      environment: process.env.NODE_ENV || 'production'
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
