const config = require('../config');

// Admin Check Middleware
module.exports = async (ctx, next) => {
  if (!ctx.from) return;
  const adminIds = config.ADMIN_IDS.split(',').map(id => id.trim());
  
  // Basic ID Check
  if (!adminIds.includes(ctx.from.id.toString())) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('❌ Akses ditolak. Anda bukan admin.', { show_alert: true }).catch(() => {});
    }
    return ctx.reply('❌ Akses ditolak. Anda bukan admin.');
  }

  const now = Date.now();
  if (!ctx.session) ctx.session = {};

  // Check if session is active
  if (ctx.session.adminAuthenticated && ctx.session.adminLoginExpires && ctx.session.adminLoginExpires > now) {
    return next();
  }

  // Session expired or not logged in
  if (ctx.session.adminAuthenticated) {
      ctx.session.adminAuthenticated = false;
      ctx.session.adminLoginExpires = null;
      if (ctx.callbackQuery) {
         return ctx.answerCbQuery('🔒 Sesi Administrator telah berakhir. Silakan login kembali memggunakan /admin', { show_alert: true }).catch(() => {});
      } else {
         return ctx.reply('🔒 Sesi Administrator telah berakhir.\n\nSilakan login kembali menggunakan:\n/admin');
      }
  }

  // Require login
  if (ctx.callbackQuery) {
    return ctx.answerCbQuery('🔐 Sesi admin belum aktif. Silakan /admin terlebih dahulu.', { show_alert: true }).catch(() => {});
  }
  
  // If text command is /admin, redirect to login scene
  const text = ctx.message?.text?.split(' ')[0] || '';
  if (text === '/admin') {
     return ctx.scene.enter('ADMIN_LOGIN_SCENE');
  } 
  
  if (ctx.message) {
     return ctx.reply('🔐 Akses ditolak. Anda harus /admin untuk login PIN terlebih dahulu.');
  }

  // Prevent any unhandled admin route skip
  return;
};
