const UserService = require('../services/user.service');
const logger = require('../utils/logger');
const { Markup } = require('telegraf');

class StartController {
  static getMainMenuExtra() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📦 Order', 'menu_order'), Markup.button.callback('🛒 Services', 'menu_services')],
      [Markup.button.callback('💰 Deposit', 'menu_deposit'), Markup.button.callback('📜 Riwayat Order', 'menu_order_history_1')],
      [Markup.button.callback('👤 Profile', 'menu_profile'), Markup.button.callback('💳 Saldo', 'menu_balance')],
      [Markup.button.callback('♻️ Refill', 'menu_refill'), Markup.button.callback('ℹ️ Info & Ketentuan', 'menu_informasi_ketentuan')]
    ]);
  }

  static getGreetingText(user) {
    const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
    return `Halo, ${fullname}! Selamat datang di SMM Bot.\n\nSilakan pilih menu di bawah ini:`;
  }

  static async handleStart(ctx) {
    try {
      const user = ctx.from;
      await UserService.createUser(user);
      logger.info(`User ${user.id} (@${user.username || 'unknown'}) accessed /start`);
      
      const text = StartController.getGreetingText(user);
      const extra = StartController.getMainMenuExtra();
      
      await ctx.reply(text, extra);
    } catch (error) {
      logger.error('Error in StartController', error);
      await ctx.reply('Terjadi kesalahan saat memulai bot.');
    }
  }

  static async handleBackToMain(ctx) {
    try {
      const user = ctx.from;
      const text = StartController.getGreetingText(user);
      const extra = StartController.getMainMenuExtra();
      
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        try {
          await ctx.editMessageText(text, extra);
        } catch (e) {
          await ctx.reply(text, extra);
        }
      } else {
        await ctx.reply(text, extra);
      }
    } catch (error) {
      logger.error('Error in handleBackToMain', error);
      await ctx.reply('Terjadi kesalahan.');
    }
  }
  static async handleInformasiKetentuan(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const { INFO_KETENTUAN } = require('../utils/messages');
      await ctx.editMessageText(INFO_KETENTUAN, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
        ])
      });
    } catch (e) {
      logger.error('Error in handleInformasiKetentuan', e);
      await ctx.reply('Terjadi kesalahan saat memuat informasi.');
    }
  }
}

module.exports = StartController;
