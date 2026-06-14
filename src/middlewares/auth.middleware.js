const UserService = require('../services/user.service');

// Auth (Ban Check) Middleware
module.exports = async (ctx, next) => {
  if (ctx.from) {
    const user = await UserService.getUser(ctx.from.id);
    if (user && user.is_banned) {
      if (ctx.callbackQuery) {
        return ctx.answerCbQuery('Akun Anda diblokir dari bot ini.', { show_alert: true }).catch(() => {});
      } else if (ctx.message && ctx.message.text) {
        return ctx.reply('❌ Akun Anda telah dibanned dan tidak dapat menggunakan bot ini.');
      }
      return; 
    }
  }
  return next();
};
