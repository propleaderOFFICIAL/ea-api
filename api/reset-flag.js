const redis = require('./lib/redis');
const { authenticateMaster } = require('./lib/auth');

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
  
  // Autenticazione
  if (!authenticateMaster(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const { value, reason } = req.body;
    
    await redis.setResetInfo(value === true, reason || 'Reset flag manuale');
    
    const resetInfo = await redis.getResetInfo();
    
    res.json({
      status: 'success',
      isReset: resetInfo.isReset,
      resetTimestamp: resetInfo.resetTimestamp,
      message: `Reset flag impostato a ${resetInfo.isReset}`
    });
    
  } catch (error) {
    console.error('Reset-flag error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
