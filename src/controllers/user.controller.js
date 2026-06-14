const UserService = require('../services/user.service');
const logger = require('../utils/logger');

class UserController {
  static async handleProfile(ctx) {
    try {
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return ctx.reply('Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      const profileText = `
👤 *PROFIL PENGGUNA*
━━━━━━━━━━━━━━━━━━━━
*ID:* \`${user.telegram_id}\`
*Username:* ${user.username ? '@' + user.username : 'Tidak diset'}
*Nama:* ${user.fullname}
*Terdaftar:* ${new Date(user.created_at).toLocaleString('id-ID')}
      `;
      
      await ctx.replyWithMarkdown(profileText.trim());
    } catch (error) {
      logger.error('Error in UserController.handleProfile', error);
      await ctx.reply('Terjadi kesalahan saat memuat profil Anda.');
    }
  }

  static async handleSaldo(ctx) {
    try {
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return ctx.reply('Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      // Mengubah angka saldo jadi format Rupiah
      const balanceStr = new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR',
        minimumFractionDigits: 0
      }).format(user.balance);
      
      const saldoText = `💰 *INFO SALDO*\nSaat ini saldo Anda adalah: *${balanceStr}*`;
      
      await ctx.replyWithMarkdown(saldoText);
    } catch (error) {
      logger.error('Error in UserController.handleSaldo', error);
      await ctx.reply('Terjadi kesalahan saat memuat saldo Anda.');
    }
  }
}

module.exports = UserController;
