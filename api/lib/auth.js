const MASTER_KEY = process.env.MASTER_KEY || "master_secret_key_2024";
const SLAVE_KEY = process.env.SLAVE_KEY || "slave_access_key_2025_08";

function authenticateMaster(req) {
  const masterkey = req.body?.masterkey || req.query?.masterkey;
  
  if (!masterkey || masterkey !== MASTER_KEY) {
    console.warn(`⚠️ WARNING GRAVE: Tentativo autenticazione Master fallito da IP ${req.headers['x-forwarded-for'] || req.connection?.remoteAddress}`);
    return false;
  }
  
  return true;
}

function authenticateSlave(req) {
  const slavekey = req.body?.slavekey || req.query?.slavekey;
  
  if (!slavekey || slavekey !== SLAVE_KEY) {
    console.warn(`⚠️ WARNING GRAVE: Tentativo autenticazione Slave fallito da IP ${req.headers['x-forwarded-for'] || req.connection?.remoteAddress}`);
    return false;
  }
  
  return true;
}

function getClientInfo(req) {
  return {
    ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown'
  };
}

module.exports = {
  authenticateMaster,
  authenticateSlave,
  getClientInfo,
  MASTER_KEY,
  SLAVE_KEY
};
