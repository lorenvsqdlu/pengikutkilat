const logger = require('../utils/logger');

// Simple in-memory rate limiter for Telegraf
const limitCache = new Map();
const WINDOW_MS = 1000; // 1 second window
const MAX_HITS = 2; // 2 messages per second

const rateLimitMiddleware = async (ctx, next) => {
  if (!ctx.from) return next();

  const userId = ctx.from.id;
  const now = Date.now();
  
  if (!limitCache.has(userId)) {
    limitCache.set(userId, { count: 1, resetTime: now + WINDOW_MS });
    return next();
  }

  const userLimit = limitCache.get(userId);
  
  if (now > userLimit.resetTime) {
    userLimit.count = 1;
    userLimit.resetTime = now + WINDOW_MS;
    limitCache.set(userId, userLimit);
    return next();
  }

  userLimit.count += 1;
  
  if (userLimit.count > MAX_HITS) {
    // Prevent spamming logs, maybe just ignore or warn once
    if (userLimit.count === MAX_HITS + 1) {
       try {
           await ctx.reply('⚠️ Anda mengirim pesan terlalu cepat. Harap tunggu sebentar.');
       } catch (e) {}
    }
    return; // Stop processing
  }

  limitCache.set(userId, userLimit);
  return next();
};

module.exports = rateLimitMiddleware;
