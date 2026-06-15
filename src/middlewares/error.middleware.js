const logger = require('../utils/logger');

/**
 * Global error handling middleware for Telegraf
 */
module.exports = async (err, ctx) => {
  const userId = ctx.from?.id || 'Unknown';
  const username = ctx.from?.username ? `@${ctx.from.username}` : 'Unknown';
  const text = ctx.message?.text || ctx.callbackQuery?.data || 'No text/data';
  const scene = ctx.session?.__scenes?.current || 'None';
  
  const errorMsg = `
ERROR GLOBAL HANDLER
━━━━━━━━━━━━━━━━━━━━
User ID: ${userId}
Username: ${username}
Text/Data: ${text}
Scene: ${scene}
Update Type: ${ctx.updateType}

Error Name: ${err.name}
Error Message: ${err.message}
Stack Trace:
${err.stack || err}
━━━━━━━━━━━━━━━━━━━━`;

  logger.error(errorMsg);
  
  try {
    if (ctx.scene && ctx.scene.current) {
        await ctx.scene.leave().catch(() => {});
    }
  } catch (e) {}

  try {
    if (ctx.reply && ctx.updateType === 'message') {
      await ctx.reply('Terjadi kesalahan tidak terduga pada sistem kami. Silakan coba lagi nanti. Hubungi admin jika error berlanjut.');
    } else if (ctx.answerCbQuery && ctx.updateType === 'callback_query') {
      await ctx.answerCbQuery('Terjadi kesalahan sistem.').catch(() => {});
    }
  } catch (replyError) {
    logger.error('Failed to send fallback error message to user', replyError);
  }
};
