const logger = require('../utils/logger');

/**
 * Global error handling middleware for Telegraf
 */
module.exports = async (err, ctx) => {
  logger.error(`[Error Global] Ooops, encountered an error for update type: ${ctx.updateType}`, err.stack || err);
  
  try {
    if (ctx.reply) {
      await ctx.reply('Terjadi kesalahan tidak terduga pada sistem kami. Silakan coba lagi nanti.');
    }
  } catch (replyError) {
    logger.error('Failed to send fallback error message to user', replyError);
  }
};
