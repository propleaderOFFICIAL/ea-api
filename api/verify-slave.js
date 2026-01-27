const redis = require('./lib/redis');
const { SLAVE_KEY } = require('./lib/auth');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { slavekey } = req.body;
    
    if (slavekey === SLAVE_KEY) {
      const [count, resetInfo] = await Promise.all([
        redis.getTradeCount(),
        redis.getResetInfo()
      ]);
      
      res.json({ 
        status: 'authorized',
        message: 'Slave key valid',
        serverTime: Date.now(),
        tradeCount: count,
        resetInfo: {
          isReset: resetInfo.isReset,
          resetTimestamp: resetInfo.resetTimestamp
        }
      });
    } else {
      res.status(401).json({ 
        status: 'unauthorized',
        message: 'Invalid slave key'
      });
    }
    
  } catch (error) {
    console.error('Verify-slave error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
