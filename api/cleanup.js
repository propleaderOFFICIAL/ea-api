const redis = require('./lib/redis');

// Endpoint chiamato da Vercel Cron per pulizia automatica
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
    // Pulisci eventi più vecchi di 6 ore
    const events = await redis.getRecentEvents(100);
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const filtered = events.filter(event => new Date(event.timestamp) > cutoff);
    
    // Se ci sono eventi da rimuovere, aggiorna la lista
    if (filtered.length !== events.length) {
      // Cancella lista esistente
      await redis.clearAllData(); // Solo eventi
      
      // Ricrea con eventi validi
      const eventsPromises = filtered.map(event => redis.addRecentEvent(event));
      await Promise.all(eventsPromises);
    }
    
    // Pulisci slave disconnessi (più vecchi di 5 minuti)
    const deletedSlaves = await redis.cleanupOldSlaves();
    
    res.json({
      status: 'success',
      eventsRemoved: events.length - filtered.length,
      slavesRemoved: deletedSlaves,
      remainingEvents: filtered.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
