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
    const {
      action, ticket, symbol, type, lots, price, sl, tp, time, comment,
      expiration, account, barsFromPlacement, timeframe, timeframeName, barTimestamp,
      openPrice, closePrice, openTime, closeTime, profit, swap, commission
    } = req.body;
    
    const timestamp = new Date().toISOString();
    const ticketNum = parseInt(ticket);
    
    // Disattiva reset se arriva un segnale di trading
    if (action === 'pending' || action === 'modify' || action === 'filled') {
      const resetInfo = await redis.getResetInfo();
      if (resetInfo.isReset) {
        await redis.setResetInfo(false, `Master ha inviato ${action} per ticket #${ticket}`);
      }
    }
    
    if (action === 'pending') {
      // Verifica se già fillato
      const filledTrades = await redis.getFilledTrades();
      if (filledTrades[ticketNum]) {
        console.warn(`⚠️ WARNING GRAVE: PENDENTE #${ticket} già fillato - possibile problema di sincronizzazione`);
        return res.json({ status: 'already_filled' });
      }
      
      const pendingOrder = {
        signalType: 'pending',
        ticket: ticketNum,
        symbol,
        type,
        lots,
        price,
        sl,
        tp,
        time,
        comment,
        expiration,
        barsFromPlacement: barsFromPlacement || 0,
        timeframe: timeframe || 0,
        timeframeName: timeframeName || 'Unknown',
        barTimestamp: barTimestamp || null,
        timestamp
      };
      
      await redis.setPendingOrder(ticketNum, pendingOrder);
      if (account) await redis.setMasterAccount(account);
      
    } else if (action === 'modify') {
      const [pendingOrders, filledTrades] = await Promise.all([
        redis.getPendingOrders(),
        redis.getFilledTrades()
      ]);
      
      if (filledTrades[ticketNum]) {
        console.warn(`⚠️ WARNING GRAVE: MODIFY IGNORATO #${ticket} già fillato`);
        return res.json({ status: 'already_filled' });
      }
      
      if (pendingOrders[ticketNum]) {
        const existing = pendingOrders[ticketNum];
        const updated = {
          ...existing,
          lots,
          price,
          sl,
          tp,
          expiration,
          barsFromPlacement: barsFromPlacement || existing.barsFromPlacement,
          timeframe: timeframe || existing.timeframe,
          timeframeName: timeframeName || existing.timeframeName,
          barTimestamp: barTimestamp || existing.barTimestamp,
          modified: true,
          timestamp
        };
        
        await redis.setPendingOrder(ticketNum, updated);
        
        await redis.addRecentEvent({
          signalType: 'modify',
          action: 'modify',
          ticket: ticketNum,
          symbol,
          price,
          sl,
          tp,
          expiration,
          barsFromPlacement,
          timeframe,
          timeframeName,
          barTimestamp,
          timestamp
        });
        
        if (account) await redis.setMasterAccount(account);
      }
      
    } else if (action === 'silentBarsUpdate') {
      const pendingOrders = await redis.getPendingOrders();
      
      if (pendingOrders[ticketNum]) {
        const existing = pendingOrders[ticketNum];
        const updated = {
          ...existing,
          barsFromPlacement: barsFromPlacement,
          timeframe: timeframe || existing.timeframe,
          timeframeName: timeframeName || existing.timeframeName,
          barTimestamp: barTimestamp || existing.barTimestamp,
          lastBarsUpdate: timestamp
        };
        
        await redis.setPendingOrder(ticketNum, updated);
      }
      
      if (account) await redis.setMasterAccount(account);
      
    } else if (action === 'filled') {
      const pendingOrders = await redis.getPendingOrders();
      
      if (pendingOrders[ticketNum]) {
        const originalPending = pendingOrders[ticketNum];
        
        const filledTrade = {
          ...originalPending,
          signalType: 'filled',
          originalTicket: ticketNum,
          filledTime: time,
          timestamp
        };
        
        await Promise.all([
          redis.deletePendingOrder(ticketNum),
          redis.setFilledTrade(ticketNum, filledTrade),
          redis.removeEventsByTicket(ticketNum)
        ]);
      }
      
      if (account) await redis.setMasterAccount(account);
      
    } else if (action === 'trade_closed') {
      const closedTrade = {
        signalType: 'trade_closed',
        ticket: ticketNum,
        symbol,
        type,
        lots,
        openPrice,
        closePrice,
        openTime,
        closeTime,
        profit,
        swap: swap || 0,
        commission: commission || 0,
        comment,
        timestamp
      };
      
      await Promise.all([
        redis.deleteFilledTrade(ticketNum),
        redis.addRecentEvent(closedTrade)
      ]);
      
      if (account) await redis.setMasterAccount(account);
      
    } else if (action === 'cancel') {
      const pendingOrders = await redis.getPendingOrders();
      
      if (pendingOrders[ticketNum]) {
        const cancelledOrder = pendingOrders[ticketNum];
        
        await Promise.all([
          redis.deletePendingOrder(ticketNum),
          redis.removeEventsByTicket(ticketNum),
          redis.addRecentEvent({
            signalType: 'cancel',
            action: 'cancel',
            ticket: ticketNum,
            symbol: cancelledOrder.symbol,
            canceltime: time,
            timestamp
          })
        ]);
        
        if (account) await redis.setMasterAccount(account);
      }
    }
    
    res.json({ status: 'success' });
    
  } catch (error) {
    console.error('Signals error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
