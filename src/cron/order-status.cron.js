const cron = require('node-cron');
const OrderService = require('../services/order.service');
const smmService = require('../services/smm.service');
const RefundService = require('../services/refund.service');
const UserService = require('../services/user.service');
const logger = require('../utils/logger');

// Helper
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

// We use an initialize function to inject the bot instance cleanly
const initOrderCron = (bot) => {
  // Jadwal berjalan setiap 5 menit
  cron.schedule('*/5 * * * *', async () => {
    logger.info('[CRON] Mulai pengecekan status order otomatis...');
    try {
      const activeOrders = await OrderService.getActiveOrders();
      if (!activeOrders || activeOrders.length === 0) {
        logger.info('[CRON] Tidak ada order aktif yang perlu dicek.');
        return;
      }

      logger.info(`[CRON] Menemukan ${activeOrders.length} order aktif. Memproses ke SMM API...`);

      // Batch processing, hindari rate-limit (Max 100 per request biasa di SMM)
      const batchSize = 100;
      for (let i = 0; i < activeOrders.length; i += batchSize) {
        const batch = activeOrders.slice(i, i + batchSize);
        // Kumpulkan api_order_id yang valid
        const apiOrderIds = batch.map(o => o.api_order_id).filter(id => id && id !== 'N/A');
        
        if (apiOrderIds.length === 0) continue;

        try {
          // Ambil status secara massal (action=status&orders=1,2,3)
          const statuses = await smmService.getOrdersStatus(apiOrderIds);
          
          if (!statuses) continue;

          // Cek tiap order di batch ini
          for (const order of batch) {
             const apiData = statuses[order.api_order_id.toString()];
             if (!apiData || !apiData.status) continue; // Skip jika data tidak lengkap
             
             let newStatus = apiData.status;

             // Standarisasi kapitalisasi
             // SMM ada yg kirim "Completed", "Canceled", "Partial"
             newStatus = newStatus.charAt(0).toUpperCase() + newStatus.slice(1).toLowerCase();

             // Jika status berubah
             if (newStatus !== order.status) {
                // Update DB
                await OrderService.updateOrderStatus(order.id, newStatus);
                logger.info(`[CRON] Order ${order.api_order_id} berubah status: ${order.status} -> ${newStatus}`);
                
                // Kirim Notifikasi via Telegram
                let icon = '🔄';
                if (newStatus === 'Completed') icon = '✅';
                if (newStatus === 'Canceled' || newStatus === 'Cancelled') icon = '❌';
                if (newStatus === 'Partial') icon = '⚠️';

                const notifMsg = `
${icon} *UPDATE STATUS ORDER*
━━━━━━━━━━━━━━━━━
*ID Order API:* \`${order.api_order_id}\`
*Layanan:* ${order.service_id}
*Target:* ${order.target}
*Status Baru:* *${newStatus}*

_Update otomatis oleh sistem._`;
                
                bot.telegram.sendMessage(order.user_id, notifMsg, { parse_mode: 'Markdown' })
                  .catch(err => {
                     logger.warn(`[CRON] Gagal mengirim notifikasi status ke user ${order.user_id}: ${err.message}`);
                  });

                // --- PENGHITUNGAN REFUND ---
                if (newStatus === 'Canceled' || newStatus === 'Cancelled' || newStatus === 'Partial') {
                   try {
                       const hasRefunded = await RefundService.hasRefunded(order.id);
                       if (!hasRefunded) {
                           let remains = parseInt(apiData.remains);
                           if (isNaN(remains)) {
                               if (newStatus === 'Canceled' || newStatus === 'Cancelled') {
                                   remains = order.quantity; // Assume full refund if no remains provided for canceled
                               } else {
                                   remains = 0; // cannot determine partial refund safely
                               }
                           }
                           
                           if (remains > 0 && remains <= order.quantity) {
                               const refundAmount = Math.floor((remains / order.quantity) * order.price);
                               if (refundAmount > 0) {
                                   const refundId = await RefundService.createRefund(order.id, order.user_id, refundAmount, `Refund for status ${newStatus} with ${remains} remains`);
                                   if (refundId > 0) {
                                       await UserService.updateBalance(order.user_id, refundAmount);
                                       
                                       const refundMsg = `
💸 *REFUND SALDO*
━━━━━━━━━━━━━━━━━
*ID Order API:* \`${order.api_order_id}\`
*Status:* ${newStatus}
*Sisa Target:* ${remains}
*Nominal Refund:* ${formatRupiah(refundAmount)}

_Saldo Anda telah berhasil dikembalikan ke akun._`;
                                   
                                       bot.telegram.sendMessage(order.user_id, refundMsg, { parse_mode: 'Markdown' }).catch(()=>{});
                                   }
                               }
                           }
                       }
                   } catch (err) {
                       logger.error(`[CRON] Gagal proses refund untuk order ${order.id}`, err);
                   }
                }
             }
          }
        } catch (err) {
           logger.error(`[CRON] Gagal memanggil API SMM batch ${i}-${i + batchSize}: `, err.message);
        }
      }
      
      logger.info('[CRON] Pengecekan status order selesai.');

    } catch (err) {
       logger.error('[CRON] Gagal menjalankan pengecekan order: ', err.message);
    }
  });
};

module.exports = initOrderCron;
