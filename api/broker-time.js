const redis = require('./lib/redis');
const { authenticateMaster } = require('./lib/auth');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // GET - Leggi broker time
    if (req.method === 'GET') {
      const brokerTimeData = await redis.getBrokerTime();
      
      res.json({
        brokerTime: brokerTimeData.brokerTime,
        lastUpdate: brokerTimeData.lastUpdate,
        serverTime: Date.now(),
        status: brokerTimeData.brokerTime ? 'available' : 'not_synced'
      });
      
    // POST - Aggiorna broker time + config slave
    } else if (req.method === 'POST') {
      // Autenticazione
      if (!authenticateMaster(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const { brokerTime, slaveAutoCloseFilledTrades } = req.body;
      
      if (brokerTime && typeof brokerTime === 'string') {
        await redis.setBrokerTime(brokerTime);
        
        // Aggiorna config slave se fornita
        if (typeof slaveAutoCloseFilledTrades === 'boolean') {
          const slaveConfig = await redis.getSlaveConfig();
          await redis.setSlaveConfig({
            autoCloseFilledTrades: slaveAutoCloseFilledTrades,
            lastUpdate: new Date().toISOString()
          });
        }
        
        const currentConfig = await redis.getSlaveConfig();
        
        res.json({ 
          status: 'success',
          brokerTime: brokerTime,
          slaveAutoCloseFilledTrades: currentConfig.autoCloseFilledTrades,
          serverTime: Date.now()
        });
      } else {
        res.status(400).json({ 
          error: 'Invalid broker time',
          message: 'brokerTime field is required'
        });
      }
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Broker-time error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
