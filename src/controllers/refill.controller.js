const RefillService = require('../services/refill.service');
const OrderService = require('../services/order.service');
const smmService = require('../services/smm.service');
const logger = require('../utils/logger');

class RefillController {
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
