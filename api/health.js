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
    const [count, resetInfo, slaveConfig, masterAccount, slavesCount] = await Promise.all([
      redis.getTradeCount(),
      redis.getResetInfo(),
      redis.getSlaveConfig(),
      redis.getMasterAccount(),
      redis.getConnectedSlavesCount()
    ]);
    
    const events = await redis.getRecentEvents(100);
    
    res.json({
      status: 'online',
      time: new Date(),
      pendingOrders: count.pendingOrders,
      filledTrades: count.filledTrades,
      totalTrades: count.totalTrades,
      isReset: resetInfo.isReset,
      resetTimestamp: resetInfo.resetTimestamp,
      recentEvents: events.length,
      connectedSlaves: slavesCount,
      masterAccount: masterAccount.number || 'N/A',
      slaveAutoClose: slaveConfig.autoCloseFilledTrades
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
