const redis = require('./lib/redis');
const { authenticateSlave } = require('./lib/auth');

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
  if (!authenticateSlave(req)) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid slave key required' 
    });
  }
  
  try {
    const { ticket } = req.body;
    const ticketNum = parseInt(ticket);
    
    const filledTrades = await redis.getFilledTrades();
    
    if (filledTrades[ticketNum]) {
      await redis.deleteFilledTrade(ticketNum);
      res.json({ status: 'confirmed' });
    } else {
      console.warn(`⚠️ WARNING GRAVE: Slave conferma ticket #${ticket} non fillato - possibile problema di sincronizzazione Master/Slave`);
      res.json({ status: 'not_found' });
    }
    
  } catch (error) {
    console.error('Slave-filled error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
