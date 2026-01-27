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
    // Clear all data
    await redis.clearAllData();
    await redis.setResetInfo(true, 'Master ha richiesto reset completo');
    
    const resetInfo = await redis.getResetInfo();
    
    res.json({ 
      status: 'success', 
      message: 'Complete reset performed',
      isReset: resetInfo.isReset,
      resetTimestamp: resetInfo.resetTimestamp
    });
    
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
