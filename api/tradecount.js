const redis = require('./lib/redis');
const { authenticateSlave } = require('./lib/auth');

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
    const [count, resetInfo] = await Promise.all([
      redis.getTradeCount(),
      redis.getResetInfo()
    ]);
    
    res.json({
      pendingOrders: count.pendingOrders,
      filledTrades: count.filledTrades,
      totalTrades: count.totalTrades,
      isReset: resetInfo.isReset,
      resetTimestamp: resetInfo.resetTimestamp,
      serverTime: Date.now(),
      status: 'success'
    });
  } catch (error) {
    console.error('Tradecount error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
