const UserService = require('../services/user.service');
const logger = require('../utils/logger');
const { Markup } = require('telegraf');

class StartController {
  static async handleStart(ctx) {
    try {
      const user = ctx.from;
      
      // Save returning / new users via Service layer (SQLite)
      await UserService.createUser(user);
      
      logger.info(`User ${user.id} (@${user.username || 'unknown'}) accessed /start`);
      
      // Send greeting with Inline Keyboard
      const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
      await ctx.reply(`Halo, ${fullname}! Selamat datang di SMM Bot.\n\nSilakan pilih menu di bawah ini:`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 Order', 'menu_order'), Markup.button.callback('🛒 Services', 'menu_services')],
          [Markup.button.callback('💰 Deposit', 'menu_deposit'), Markup.button.callback('📜 Riwayat Deposit', 'menu_history')],
          [Markup.button.callback('👤 Profile', 'menu_profile'), Markup.button.callback('💳 Saldo', 'menu_balance')],
          [Markup.button.callback('♻️ Refill', 'menu_refill')]
        ])
      });
    } catch (error) {
      logger.error('Error in StartController', error);
      await ctx.reply('Terjadi kesalahan saat memulai bot.');
    }
  }
}

module.exports = StartController;
