const { Redis } = require('@upstash/redis');

// Inizializza Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Prefix per separare dati di EA diversi
const PREFIX = process.env.PREFIX || 'default_';

// Chiavi Redis
const KEYS = {
  pendingOrders: `${PREFIX}pendingOrders`,
  filledTrades: `${PREFIX}filledTrades`,
  recentEvents: `${PREFIX}recentEvents`,
  masterAccount: `${PREFIX}masterAccount`,
  slaveConfig: `${PREFIX}slaveConfig`,
  resetInfo: `${PREFIX}resetInfo`,
  brokerTime: `${PREFIX}brokerTime`,
  connectedSlaves: `${PREFIX}connectedSlaves`
};

//+------------------------------------------------------------------+
//| PENDING ORDERS - Redis Hash                                      |
//+------------------------------------------------------------------+

async function getPendingOrders() {
  try {
    const data = await redis.hgetall(KEYS.pendingOrders);
    if (!data) return {};
    
    // Converti stringhe JSON in oggetti
    const result = {};
    for (const [ticket, value] of Object.entries(data)) {
      result[ticket] = JSON.parse(value);
    }
    return result;
  } catch (error) {
    console.error('Redis getPendingOrders error:', error);
    return {};
  }
}

async function setPendingOrder(ticket, orderData) {
  try {
    await redis.hset(KEYS.pendingOrders, { [ticket]: JSON.stringify(orderData) });
    return true;
  } catch (error) {
    console.error('Redis setPendingOrder error:', error);
    return false;
  }
}

async function deletePendingOrder(ticket) {
  try {
    await redis.hdel(KEYS.pendingOrders, ticket);
    return true;
  } catch (error) {
    console.error('Redis deletePendingOrder error:', error);
    return false;
  }
}

async function getPendingOrdersCount() {
  try {
    const count = await redis.hlen(KEYS.pendingOrders);
    return count || 0;
  } catch (error) {
    console.error('Redis getPendingOrdersCount error:', error);
    return 0;
  }
}

//+------------------------------------------------------------------+
//| FILLED TRADES - Redis Hash                                       |
//+------------------------------------------------------------------+

async function getFilledTrades() {
  try {
    const data = await redis.hgetall(KEYS.filledTrades);
    if (!data) return {};
    
    const result = {};
    for (const [ticket, value] of Object.entries(data)) {
      result[ticket] = JSON.parse(value);
    }
    return result;
  } catch (error) {
    console.error('Redis getFilledTrades error:', error);
    return {};
  }
}

async function setFilledTrade(ticket, tradeData) {
  try {
    await redis.hset(KEYS.filledTrades, { [ticket]: JSON.stringify(tradeData) });
    return true;
  } catch (error) {
    console.error('Redis setFilledTrade error:', error);
    return false;
  }
}

async function deleteFilledTrade(ticket) {
  try {
    await redis.hdel(KEYS.filledTrades, ticket);
    return true;
  } catch (error) {
    console.error('Redis deleteFilledTrade error:', error);
    return false;
  }
}

async function getFilledTradesCount() {
  try {
    const count = await redis.hlen(KEYS.filledTrades);
    return count || 0;
  } catch (error) {
    console.error('Redis getFilledTradesCount error:', error);
    return 0;
  }
}

//+------------------------------------------------------------------+
//| RECENT EVENTS - Redis List (LPUSH + LTRIM per max 100)          |
//+------------------------------------------------------------------+

async function getRecentEvents(limit = 100) {
  try {
    const events = await redis.lrange(KEYS.recentEvents, 0, limit - 1);
    return events.map(e => JSON.parse(e));
  } catch (error) {
    console.error('Redis getRecentEvents error:', error);
    return [];
  }
}

async function addRecentEvent(eventData) {
  try {
    // Aggiungi all'inizio della lista
    await redis.lpush(KEYS.recentEvents, JSON.stringify(eventData));
    // Mantieni solo ultimi 100
    await redis.ltrim(KEYS.recentEvents, 0, 99);
    return true;
  } catch (error) {
    console.error('Redis addRecentEvent error:', error);
    return false;
  }
}

async function removeEventsByTicket(ticket) {
  try {
    const events = await getRecentEvents();
    const filtered = events.filter(e => e.ticket !== ticket);
    
    // Cancella lista esistente
    await redis.del(KEYS.recentEvents);
    
    // Ricrea con eventi filtrati
    if (filtered.length > 0) {
      const pipeline = redis.pipeline();
      filtered.forEach(event => {
        pipeline.lpush(KEYS.recentEvents, JSON.stringify(event));
      });
      await pipeline.exec();
    }
    
    return true;
  } catch (error) {
    console.error('Redis removeEventsByTicket error:', error);
    return false;
  }
}

async function getRecentEventsAfterSync(syncTimestamp) {
  try {
    const events = await getRecentEvents();
    const syncTime = new Date(parseInt(syncTimestamp));
    return events.filter(event => new Date(event.timestamp) > syncTime);
  } catch (error) {
    console.error('Redis getRecentEventsAfterSync error:', error);
    return [];
  }
}

//+------------------------------------------------------------------+
//| MASTER ACCOUNT INFO - Redis String                               |
//+------------------------------------------------------------------+

async function getMasterAccount() {
  try {
    const data = await redis.get(KEYS.masterAccount);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Redis getMasterAccount error:', error);
    return {};
  }
}

async function setMasterAccount(accountData) {
  try {
    const data = {
      ...accountData,
      lastUpdated: new Date().toISOString()
    };
    await redis.set(KEYS.masterAccount, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Redis setMasterAccount error:', error);
    return false;
  }
}

//+------------------------------------------------------------------+
//| SLAVE CONFIG - Redis String                                      |
//+------------------------------------------------------------------+

async function getSlaveConfig() {
  try {
    const data = await redis.get(KEYS.slaveConfig);
    return data ? JSON.parse(data) : { autoCloseFilledTrades: false, lastUpdate: null };
  } catch (error) {
    console.error('Redis getSlaveConfig error:', error);
    return { autoCloseFilledTrades: false, lastUpdate: null };
  }
}

async function setSlaveConfig(configData) {
  try {
    await redis.set(KEYS.slaveConfig, JSON.stringify(configData));
    return true;
  } catch (error) {
    console.error('Redis setSlaveConfig error:', error);
    return false;
  }
}

//+------------------------------------------------------------------+
//| RESET INFO - Redis String                                        |
//+------------------------------------------------------------------+

async function getResetInfo() {
  try {
    const data = await redis.get(KEYS.resetInfo);
    return data ? JSON.parse(data) : { isReset: false, resetTimestamp: null };
  } catch (error) {
    console.error('Redis getResetInfo error:', error);
    return { isReset: false, resetTimestamp: null };
  }
}

async function setResetInfo(isReset, reason = '') {
  try {
    const data = {
      isReset: isReset,
      resetTimestamp: isReset ? new Date().toISOString() : null,
      reason: reason
    };
    await redis.set(KEYS.resetInfo, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Redis setResetInfo error:', error);
    return false;
  }
}

//+------------------------------------------------------------------+
//| BROKER TIME - Redis String                                       |
//+------------------------------------------------------------------+

async function getBrokerTime() {
  try {
    const data = await redis.get(KEYS.brokerTime);
    return data ? JSON.parse(data) : { brokerTime: null, lastUpdate: null };
  } catch (error) {
    console.error('Redis getBrokerTime error:', error);
    return { brokerTime: null, lastUpdate: null };
  }
}

async function setBrokerTime(brokerTime) {
  try {
    const data = {
      brokerTime: brokerTime,
      lastUpdate: new Date().toISOString()
    };
    await redis.set(KEYS.brokerTime, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Redis setBrokerTime error:', error);
    return false;
  }
}

//+------------------------------------------------------------------+
//| CONNECTED SLAVES - Redis Hash con TTL                            |
//+------------------------------------------------------------------+

async function trackSlave(slaveId, data) {
  try {
    const slaveData = {
      lastAccess: new Date().toISOString(),
      ip: data.ip,
      userAgent: data.userAgent
    };
    await redis.hset(KEYS.connectedSlaves, { [slaveId]: JSON.stringify(slaveData) });
    return true;
  } catch (error) {
    console.error('Redis trackSlave error:', error);
    return false;
  }
}

async function getConnectedSlaves() {
  try {
    const data = await redis.hgetall(KEYS.connectedSlaves);
    if (!data) return {};
    
    const result = {};
    for (const [id, value] of Object.entries(data)) {
      result[id] = JSON.parse(value);
    }
    return result;
  } catch (error) {
    console.error('Redis getConnectedSlaves error:', error);
    return {};
  }
}

async function cleanupOldSlaves() {
  try {
    const slaves = await getConnectedSlaves();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const toDelete = [];
    for (const [id, data] of Object.entries(slaves)) {
      const lastAccess = new Date(data.lastAccess);
      if (lastAccess < fiveMinutesAgo) {
        toDelete.push(id);
      }
    }
    
    if (toDelete.length > 0) {
      await redis.hdel(KEYS.connectedSlaves, ...toDelete);
    }
    
    return toDelete.length;
  } catch (error) {
    console.error('Redis cleanupOldSlaves error:', error);
    return 0;
  }
}

async function getConnectedSlavesCount() {
  try {
    const count = await redis.hlen(KEYS.connectedSlaves);
    return count || 0;
  } catch (error) {
    console.error('Redis getConnectedSlavesCount error:', error);
    return 0;
  }
}

//+------------------------------------------------------------------+
//| BULK OPERATIONS                                                   |
//+------------------------------------------------------------------+

async function clearAllData() {
  try {
    const pipeline = redis.pipeline();
    pipeline.del(KEYS.pendingOrders);
    pipeline.del(KEYS.filledTrades);
    pipeline.del(KEYS.recentEvents);
    pipeline.del(KEYS.masterAccount);
    pipeline.del(KEYS.connectedSlaves);
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('Redis clearAllData error:', error);
    return false;
  }
}

async function getTradeCount() {
  try {
    const [pending, filled] = await Promise.all([
      getPendingOrdersCount(),
      getFilledTradesCount()
    ]);
    return {
      pendingOrders: pending,
      filledTrades: filled,
      totalTrades: pending + filled
    };
  } catch (error) {
    console.error('Redis getTradeCount error:', error);
    return { pendingOrders: 0, filledTrades: 0, totalTrades: 0 };
  }
}

//+------------------------------------------------------------------+
//| EXPORT                                                            |
//+------------------------------------------------------------------+

module.exports = {
  // Pending Orders
  getPendingOrders,
  setPendingOrder,
  deletePendingOrder,
  getPendingOrdersCount,
  
  // Filled Trades
  getFilledTrades,
  setFilledTrade,
  deleteFilledTrade,
  getFilledTradesCount,
  
  // Recent Events
  getRecentEvents,
  addRecentEvent,
  removeEventsByTicket,
  getRecentEventsAfterSync,
  
  // Master Account
  getMasterAccount,
  setMasterAccount,
  
  // Slave Config
  getSlaveConfig,
  setSlaveConfig,
  
  // Reset Info
  getResetInfo,
  setResetInfo,
  
  // Broker Time
  getBrokerTime,
  setBrokerTime,
  
  // Connected Slaves
  trackSlave,
  getConnectedSlaves,
  cleanupOldSlaves,
  getConnectedSlavesCount,
  
  // Bulk Operations
  clearAllData,
  getTradeCount
};
