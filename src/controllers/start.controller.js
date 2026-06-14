const UserService = require('../services/user.service');
const logger = require('../utils/logger');

class StartController {
  static async handleStart(ctx) {
    try {
      const user = ctx.from;
      
      // Save returning / new users to MySQL via Service layer
      await UserService.createUser(user);
      
      logger.info(`User ${user.id} (@${user.username || 'unknown'}) accessed /start`);
      
      // Send greeting
      const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
      await ctx.reply(`Halo, ${fullname}! Selamat datang di bot ini. Pendaftaran otomatis berhasil.\n\nGunakan perintah:\n/profile - Lihat Profil\n/saldo - Cek Saldo`);
    } catch (error) {
      logger.error('Error in StartController', error);
      await ctx.reply('Terjadi kesalahan saat memulai bot.');
    }
  }
}

module.exports = StartController;
