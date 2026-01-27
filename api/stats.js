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
    const [pendingOrders, filledTrades, count, resetInfo, slaveConfig, masterAccount] = await Promise.all([
      redis.getPendingOrders(),
      redis.getFilledTrades(),
      redis.getTradeCount(),
      redis.getResetInfo(),
      redis.getSlaveConfig(),
      redis.getMasterAccount()
    ]);
    
    const recentEvents = await redis.getRecentEvents(10);
    
    // Pulisci slave disconnessi
    const deletedSlaves = await redis.cleanupOldSlaves();
    
    const connectedSlavesData = await redis.getConnectedSlaves();
    const connectedSlavesArray = Object.entries(connectedSlavesData).map(([id, data]) => ({
      id: id.substr(0, 20) + '...',
      lastAccess: data.lastAccess,
      ip: data.ip
    }));
    
    // Statistiche per simbolo
    const stats = {};
    
    Object.values(pendingOrders).forEach(order => {
      if (!stats[order.symbol]) {
        stats[order.symbol] = { pendingOrders: 0, filledTrades: 0, timeframes: [] };
      }
      stats[order.symbol].pendingOrders++;
      if (order.timeframeName && !stats[order.symbol].timeframes.includes(order.timeframeName)) {
        stats[order.symbol].timeframes.push(order.timeframeName);
      }
    });
    
    Object.values(filledTrades).forEach(trade => {
      if (!stats[trade.symbol]) {
        stats[trade.symbol] = { pendingOrders: 0, filledTrades: 0, timeframes: [] };
      }
      stats[trade.symbol].filledTrades++;
    });
    
    res.json({
      summary: {
        pendingOrders: count.pendingOrders,
        filledTrades: count.filledTrades,
        totalTrades: count.totalTrades,
        isReset: resetInfo.isReset,
        resetTimestamp: resetInfo.resetTimestamp,
        recentEvents: recentEvents.length,
        connectedSlaves: connectedSlavesArray.length
      },
      symbolBreakdown: stats,
      recentEvents: recentEvents,
      masterAccount: masterAccount,
      slaveConfig: slaveConfig,
      connectedSlaves: connectedSlavesArray,
      serverUptime: 'N/A (serverless)'
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
