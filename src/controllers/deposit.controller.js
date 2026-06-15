const DepositService = require('../services/deposit.service');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');
const { Markup } = require('telegraf');

// Helper
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

class DepositController {
  static async handleHistory(ctx) {
    try {
      const deposits = await DepositService.getDepositHistory(ctx.from.id, 5); // ambil 5 terakhir
      
      const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
      ]);

      if (!deposits || deposits.length === 0) {
        return await sendOrEdit(ctx, 'Anda belum memiliki riwayat deposit.', { ...keyboard });
      }
      
      let text = `📜 *RIWAYAT 5 DEPOSIT TERAKHIR*\n━━━━━━━━━━━━━━━━━\n\n`;
      
      deposits.forEach((dep, idx) => {
         let statusIcon = '⏳';
         if (dep.status === 'Paid') statusIcon = '✅';
         if (dep.status === 'Failed') statusIcon = '❌';

         text += `*#${idx + 1} | ${dep.reference_id}*\n`;
         text += `Metode : ${dep.payment_method}\n`;
         text += `Jumlah : ${formatRupiah(dep.amount)}\n`;
         text += `Status : ${statusIcon} ${dep.status}\n`;
         text += `Tanggal: ${new Date(dep.created_at).toLocaleString('id-ID')}\n`;
         text += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n`;
      });

      await sendOrEdit(ctx, text, { parse_mode: 'Markdown', ...keyboard });

    } catch (error) {
      logger.error('DepositController.handleHistory Error', error);
      await sendOrEdit(ctx, 'Terjadi kesalahan saat mengambil riwayat deposit.');
    }
  }
}

module.exports = DepositController;
