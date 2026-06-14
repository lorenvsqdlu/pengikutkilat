const config = require('../config');

// Admin Check Middleware
module.exports = async (ctx, next) => {
  if (!ctx.from) return;
  const adminIds = config.ADMIN_IDS.split(',').map(id => id.trim());
  
  if (!adminIds.includes(ctx.from.id.toString())) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('❌ Akses ditolak. Anda bukan admin.', { show_alert: true }).catch(() => {});
    }
    return ctx.reply('❌ Akses ditolak. Anda bukan admin.');
  }
  
  return next();
};
