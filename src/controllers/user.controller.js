const UserService = require('../services/user.service');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');
const { Markup } = require('telegraf');

class UserController {
  static async handleProfile(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return await sendOrEdit(ctx, 'Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      const profileText = `
👤 *PROFIL PENGGUNA*
━━━━━━━━━━━━━━━━━━━━
*ID:* \`${user.telegram_id}\`
*Username:* ${user.username ? '@' + user.username : 'Tidak diset'}
*Nama:* ${user.fullname}
*Terdaftar:* ${new Date(user.created_at).toLocaleString('id-ID')}
      `;
      
      await sendOrEdit(ctx, profileText.trim(), { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
        ])
      });
    } catch (error) {
      logger.error('Error in UserController.handleProfile', error);
      await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat profil Anda.');
    }
  }

  static async handleSaldo(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return await sendOrEdit(ctx, 'Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      // Mengubah angka saldo jadi format Rupiah
      const balanceStr = new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR',
        minimumFractionDigits: 0
      }).format(user.balance);
      
      const saldoText = `💰 *INFO SALDO*\nSaat ini saldo Anda adalah: *${balanceStr}*`;
      
      await sendOrEdit(ctx, saldoText, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
        ])
      });
    } catch (error) {
      logger.error('Error in UserController.handleSaldo', error);
      await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat saldo Anda.');
    }
  }

  static async handleServices(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      // Allow searching by parsing args if from text command
      let keyword = '';
      if (ctx.message && ctx.message.text) {
          keyword = ctx.message.text.split(' ').slice(1).join(' ');
      }
      
      const smmService = require('../services/smm.service');
      const AdminService = require('../services/admin.service');
      const config = require('../config');
      
      const queryStr = keyword.trim();
      let grouped = [];
      
      if (queryStr) {
          grouped = smmService.searchServices(queryStr);
      } else {
          grouped = smmService.getGroupedServices();
      }
      
      const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
      ]);

      if (!grouped || grouped.length === 0) {
         return await sendOrEdit(ctx, queryStr ? `Pencarian "${queryStr}" tidak menemukan layanan apapun.` : 'Daftar layanan sedang kosong atau belum tersedia.', { ...keyboard });
      }
      
      const ProfitEngine = require('../services/profit.engine');
      const formatRupiah = (angka) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
      };
      
      let resText = `📋 *DAFTAR LAYANAN*\n${queryStr ? `Pencarian: ${queryStr}\n` : ''}━━━━━━━━━━━━━━━━\n`;
      
      // Limit to max 10 categories if no search to avoid too long message
      const displayGroups = queryStr ? grouped : grouped.slice(0, 10);
      
      for (const group of displayGroups) {
          let catText = `\n📂 *${group.category}*\n`;
          let limitItems = queryStr ? group.services : group.services.slice(0, 5);
          for (const s of limitItems) {
              const basePrice = parseFloat(s.price);
              const calculated = await ProfitEngine.calculatePrice(basePrice, 1000, group.category);
              const sellPrice = calculated.sell_price;
              catText += ` ↳ ID: \`${s.service || s.id}\` | ${s.name}\n     💰 ${formatRupiah(sellPrice)} | 📊 Min: ${s.min} Max: ${s.max} | ⚙️ Tipe: ${s.type}\n`;
          }
          if (!queryStr && group.services.length > 5) {
               catText += `   ... _dan ${group.services.length - 5} lainnya (Gunakan pencarian)_ \n`;
          }
          
          if (resText.length + catText.length > 3500) {
              resText += `\n_...Pesan terlalu panjang, silakan gunakan pencarian._`;
              break;
          }
          resText += catText;
      }
      
      if (!queryStr) {
          resText += `\n💡 Tip: Coba cari dengan \`/services instagram\` atau \`/services follower\``;
      }
      
      await sendOrEdit(ctx, resText, { parse_mode: 'Markdown', ...keyboard });
      
    } catch (error) {
       logger.error('Error in handleServices', error);
       await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat daftar layanan.');
    }
  }
}

module.exports = UserController;
