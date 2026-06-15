const RefillService = require('../services/refill.service');
const OrderService = require('../services/order.service');
const smmService = require('../services/smm.service');
const logger = require('../utils/logger');

class RefillController {
  static async handleRefillCallback(ctx) {
     try {
         const orderIdStr = ctx.match && ctx.match[1];
         if (!orderIdStr) return;
         await ctx.answerCbQuery().catch(() => {});
         const orderId = parseInt(orderIdStr, 10);
         
         const order = await OrderService.getOrderById(orderId);
         if (!order || order.user_id != ctx.from.id) {
             return ctx.answerCbQuery('⚠️ Order tidak ditemukan di riwayat Anda.', { show_alert: true });
         }

         if (order.status.toLowerCase() !== 'completed' && order.status.toLowerCase() !== 'partial') {
             return ctx.answerCbQuery(`⚠️ Order masih berstatus ${order.status}, tidak bisa di-refill.`, { show_alert: true });
         }

         const count = await RefillService.getRefillCount(order.id);
         if (count >= 3) {
             return ctx.answerCbQuery('⚠️ Batas maksimal refill (3x) telah tercapai.', { show_alert: true });
         }

         await ctx.editMessageText(`⏳ Memproses permintaan refill ke pusat...`);

         let refillResponse;
         try {
             refillResponse = await smmService.refillOrder(order.api_order_id);
         } catch (error) {
             logger.error(`Refill error for order ${order.id}:`, error.message);
             return ctx.editMessageText('❌ Terjadi kesalahan saat request refill ke server.', {
                ...require('telegraf').Markup.inlineKeyboard([[require('telegraf').Markup.button.callback('🔙 Kembali', `order_detail_${order.id}`)]])
             });
         }

         if (refillResponse && refillResponse.status === true && refillResponse.refill) {
             const apiRefillId = refillResponse.refill.toString();
             await RefillService.createRefill(order.id, order.user_id, apiRefillId);
             
             await ctx.editMessageText(`✅ *Permintaan Refill Berhasil!*\n\nID Order anda: ${order.id}\nRefill ID API: ${apiRefillId}\nStatus: Diproses\n\nSistem memantau status secara otomatis.`, {
                parse_mode: 'Markdown',
                ...require('telegraf').Markup.inlineKeyboard([[require('telegraf').Markup.button.callback('🔙 Kembali', `order_detail_${order.id}`)]])
             });
         } else {
             const errorMsg = refillResponse ? (refillResponse.msg || refillResponse.error || 'Server menolak') : 'Unknown error';
             await ctx.editMessageText(`❌ Refill ditolak: ${errorMsg}`, {
                ...require('telegraf').Markup.inlineKeyboard([[require('telegraf').Markup.button.callback('🔙 Kembali', `order_detail_${order.id}`)]])
             });
         }
     } catch (error) {
         logger.error('Error in handleRefillCallback', error);
         await ctx.answerCbQuery('Terjadi kesalahan sistem.', { show_alert: true });
     }
  }

  static async handleRefillHistory(ctx) {
      try {
          if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
          const UserService = require('../services/user.service');
          const user = await UserService.getUser(ctx.from.id);
          if (!user) return;

          const page = ctx.match && ctx.match[1] ? parseInt(ctx.match[1]) : 1;
          const limit = 5;
          const offset = (page - 1) * limit;

          const db = require('../database');
          const [refills] = await db.query(`SELECT r.*, o.service_name FROM refills r LEFT JOIN orders o ON r.order_id = o.id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [user.telegram_id, limit, offset]);
          const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM refills WHERE user_id = ?`, [user.telegram_id]);

          const { Markup } = require('telegraf');
          if (refills.length === 0) {
              return ctx.editMessageText('Belum ada riwayat refill.', { 
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]])
              }).catch(()=>{});
          }

          let txt = `♻️ *Riwayat Refill (Halaman ${page})*\n\n`;
          refills.forEach(r => {
              const d = new Date(r.created_at).toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
              const shortName = r.service_name ? r.service_name.substring(0, 15) + '..' : 'Layanan';
              txt += `*Refill #${r.id}* (Order #${r.order_id})\nLayanan: ${shortName}\nStatus: *${r.status}*\n📅 ${d}\n\n`;
          });

          const navButtons = [];
          if (page > 1) navButtons.push(Markup.button.callback('⬅️ Prev', `menu_refill_history_${page - 1}`));
          if ((offset + limit) < total) navButtons.push(Markup.button.callback('Next ➡️', `menu_refill_history_${page + 1}`));

          const buttons = [];
          if (navButtons.length > 0) buttons.push(navButtons);
          buttons.push([Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]);

          await ctx.editMessageText(txt.trim(), {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard(buttons)
          }).catch(()=>{});

      } catch (e) {
          logger.error('handleRefillHistory error', e);
      }
  }
  static async handleRefill(ctx) {
    try {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) {
        return ctx.reply('⚠️ Format salah.\nGunakan: /refill <ID Order>');
      }

      const orderId = parseInt(parts[1], 10);
      if (isNaN(orderId)) {
        return ctx.reply('⚠️ ID Order tidak valid.');
      }

      // Check if order exists and belongs to user
      const order = await OrderService.getOrderById(orderId);

      if (!order || order.user_id != ctx.from.id) {
        return ctx.reply('⚠️ Order tidak ditemukan di riwayat Anda.');
      }

      if (order.status.toLowerCase() !== 'completed' && order.status.toLowerCase() !== 'partial') {
         return ctx.reply(`⚠️ Order masih berstatus ${order.status}, tidak bisa di-refill.`);
      }

      // Hitung limit refill (misal: max 3 kali per order)
      const count = await RefillService.getRefillCount(order.id);
      if (count >= 3) {
         return ctx.reply('⚠️ Batas maksimal refill untuk order ini telah tercapai (Max 3 kali).');
      }

      const processingMessage = await ctx.reply('⏳ Memproses permintaan refill ke pusat...');

      // Call API
      let refillResponse;
      try {
         refillResponse = await smmService.refillOrder(order.api_order_id);
      } catch (error) {
         logger.error(`Refill error for order ${order.id}:`, error.message);
         await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
         return ctx.reply('❌ Terjadi kesalahan saat request refill ke server.');
      }

      if (refillResponse && refillResponse.status === true && refillResponse.refill) {
         // Create target
         const apiRefillId = refillResponse.refill.toString();
         await RefillService.createRefill(order.id, order.user_id, apiRefillId);
         
         await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
         await ctx.reply(`✅ *Permintaan Refill Berhasil!*\n\nID Order anda: ${order.id}\nRefill ID API: ${apiRefillId}\nStatus: Diproses\n\nSistem akan memantau status refill order Anda secara otomatis.`, {parse_mode: 'Markdown'});
      } else {
         await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
         const errorMsg = refillResponse ? (refillResponse.msg || refillResponse.error || 'Server menolak') : 'Unknown error';
         await ctx.reply(`❌ Refill ditolak: ${errorMsg}`);
      }

    } catch (error) {
      logger.error('Error in handleRefill', error);
      await ctx.reply('Terjadi kesalahan sistem.');
    }
  }
}

module.exports = RefillController;
