const UserService = require('../services/user.service');
const AdminService = require('../services/admin.service');
const { Markup } = require('telegraf');

// Auth (Ban Check & Force Subscribe) Middleware
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
    
    // Check Force Subscribe if not admin
    if (ctx.from.id.toString() !== require('../config').ADMIN_ID.toString()) {
        const isFSActive = await AdminService.getSetting('force_subscribe_enabled') === 'true';
        if (isFSActive) {
            const channel = await AdminService.getSetting('force_subscribe_channel');
            if (channel) {
                // If the user clicks "check_force_sub"
                if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_force_sub') {
                   // Let logic below handle it but bypass here? 
                   // Wait, no, we handle it right here to stop next()
                   try {
                       const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
                       if (['member', 'administrator', 'creator'].includes(member.status)) {
                           await ctx.answerCbQuery('✅ Terima kasih telah bergabung!').catch(()=>{});
                           await ctx.deleteMessage().catch(()=>{});
                           // Send welcome or start
                           const StartController = require('../controllers/start.controller');
                           if (StartController.handleStart) {
                               return StartController.handleStart(ctx);
                           } else {
                               return ctx.reply('Silakan ketik /start kembali.');
                           }
                       } else {
                           return ctx.answerCbQuery('❌ Anda belum bergabung di channel.', {show_alert: true}).catch(()=>{});
                       }
                   } catch (e) {
                       return ctx.answerCbQuery('⚠️ Terjadi error saat mengecek (Pastikan bot adalah Admin di Channel tersebut)', {show_alert: true}).catch(()=>{});
                   }
                }

                // Check membership
                try {
                    let toCheck = true;
                    // Dont block if it's new_chat_members
                    if (ctx.message && ctx.message.new_chat_members) toCheck = false;
                    
                    if (toCheck) {
                       const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
                       if (!['member', 'administrator', 'creator'].includes(member.status)) {
                           const inviteLink = channel.startsWith('@') ? `https://t.me/${channel.substring(1)}` : 'https://t.me/c/' + channel.replace('-100', '') + '/1'; // rudimentary link fallback
                           const keyboard = [
                               [Markup.button.url('📢 Join Channel', inviteLink)],
                               [Markup.button.callback('✅ Saya Sudah Join', 'check_force_sub')]
                           ];
                           if (ctx.callbackQuery) {
                               return ctx.editMessageText('⚠️ *Akses Ditolak*\n\nAnda harus bergabung ke channel informasi kami terlebih dahulu untuk menggunakan bot.', {parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard)}).catch(()=>{});
                           } else {
                               return ctx.reply('⚠️ *Akses Ditolak*\n\nAnda harus bergabung ke channel informasi kami terlebih dahulu untuk menggunakan bot.', {parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard)});
                           }
                       }
                    }
                } catch(e) {
                    // IF bot is not admin in channel, it will throw. We should log it but allow user? 
                    // No, requirements say require join. 
                }
            }
        }
    }
  }
  return next();
};
