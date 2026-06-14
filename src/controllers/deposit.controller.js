const DepositService = require('../services/deposit.service');
const logger = require('../utils/logger');

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
      
      if (!deposits || deposits.length === 0) {
        return ctx.reply('Anda belum memiliki riwayat deposit.');
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

      await ctx.reply(text, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('DepositController.handleHistory Error', error);
      await ctx.reply('Terjadi kesalahan saat mengambil riwayat deposit.');
    }
  }
}

module.exports = DepositController;
