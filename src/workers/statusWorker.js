const OrderService = require('../services/order.service');
const smmService = require('../services/smm.service');
const RefundService = require('../services/refund.service');
const UserService = require('../services/user.service');
const logger = require('../utils/logger');

let bot;
let statusQueue = [];

const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

// Periodically fetch active orders and push to queue
setInterval(async () => {
    try {
        const activeOrders = await OrderService.getActiveOrders();
        // Clear old queue to avoid duplicates if processing is slow
        statusQueue = [];
        
        for (const order of activeOrders) {
            if (order.api_order_id && order.api_order_id !== 'N/A') {
                statusQueue.push(order);
            }
        }
        if (statusQueue.length > 0) {
           logger.info(`[STATUS WORKER] Added ${statusQueue.length} pending orders to status queue.`);
        }
    } catch (e) {
        if (e.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED')) {
            logger.warn('[STATUS WORKER] Database connection refused. Retrying later...');
        } else {
            logger.error('[STATUS WORKER] Error fetching active orders', e);
        }
    }
}, 180000); // 3 minutes interval to fetch active orders

async function startStatusWorker(telegramBot) {
    bot = telegramBot;
    logger.info('[WORKER] Status Worker started.');
    
    setInterval(async () => {
        const batch = statusQueue.splice(0, 50);
        if (!batch.length) return;

        const apiOrderIds = batch.map(x => x.api_order_id);
        
        try {
            const statuses = await smmService.getOrdersStatus(apiOrderIds);
            if (!statuses) return;

            for (const order of batch) {
                 let apiData = statuses[order.api_order_id.toString()];
                 if (!apiData && Array.isArray(statuses)) {
                     apiData = statuses.find(s => s.id == order.api_order_id || s.order == order.api_order_id);
                 }
                 if (!apiData) {
                     if (statuses.order_status || statuses.status) {
                        if (batch.length === 1 || statuses.id == order.api_order_id) {
                            apiData = statuses;
                        }
                     }
                 }

                 if (!apiData) continue;
                 
                 let rawStatus = apiData.order_status || apiData.status;
                 if (!rawStatus || typeof rawStatus === 'boolean') continue;
                 
                 let newStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();

                 if (newStatus !== order.status) {
                    await OrderService.updateOrderStatus(order.id, newStatus);
                    logger.info(`[WORKER] Order ${order.api_order_id} changed status: ${order.status} -> ${newStatus}`);
                    
                    let icon = '🔄';
                    if (newStatus === 'Completed') icon = '✅';
                    if (newStatus === 'Canceled' || newStatus === 'Cancelled') icon = '❌';
                    if (newStatus === 'Partial') icon = '⚠️';

                    const notifMsg = `${icon} *UPDATE STATUS ORDER*\n━━━━━━━━━━━━━━━━━\n*ID Order API:* \`${order.api_order_id}\`\n*Layanan:* ${order.service_id}\n*Target:* ${order.target}\n*Status Baru:* *${newStatus}*\n\n_Update otomatis oleh sistem._`;
                    
                    if (bot) bot.telegram.sendMessage(order.user_id, notifMsg, { parse_mode: 'Markdown' }).catch(()=>{});

                    // PENGHITUNGAN REFUND
                    if (newStatus === 'Canceled' || newStatus === 'Cancelled' || newStatus === 'Partial') {
                       try {
                           const hasRefunded = await RefundService.hasRefunded(order.id);
                           if (!hasRefunded) {
                               let remains = parseInt(apiData.remains);
                               if (isNaN(remains) && statuses.remains !== undefined) remains = parseInt(statuses.remains);
                               if (isNaN(remains)) {
                                   if (newStatus === 'Canceled' || newStatus === 'Cancelled') remains = order.quantity;
                                   else remains = 0;
                               }
                               
                               if (remains > 0 && remains <= order.quantity) {
                                   let sellPrice = parseFloat(order.sell_price || order.price);
                                   let orderQuantity = parseInt(order.quantity);

                                   const refundAmount = Math.floor((sellPrice / orderQuantity) * remains);
                                   if (refundAmount > 0) {
                                       const refundId = await RefundService.processRefund(order.id, order.user_id, refundAmount, `Refund for status ${newStatus} with ${remains} remains`);
                                       if (refundId > 0) {
                                           logger.info(`[WORKER] Refund sukses untuk order ${order.id}: ${refundAmount} (Remains: ${remains})`);
                                           const refundMsg = `💸 *REFUND SALDO*\n━━━━━━━━━━━━━━━━━\n*ID Order API:* \`${order.api_order_id}\`\n*Status:* ${newStatus}\n*Sisa Target:* ${remains}\n*Nominal Refund:* ${formatRupiah(refundAmount)}\n\n_Saldo Anda telah berhasil dikembalikan ke akun._`;
                                           if (bot) bot.telegram.sendMessage(order.user_id, refundMsg, { parse_mode: 'Markdown' }).catch(()=>{});
                                       }
                                   }
                               }
                           }
                       } catch (err) {
                           logger.error(`[WORKER] Gagal proses refund untuk order ${order.id}`, err);
                       }
                    }
                 }
            }
        } catch (err) {
            logger.error(`[WORKER] Failed SMM batch status info: `, err.message);
        }
    }, 5000); // Check every 5 seconds for batched items
}

module.exports = startStatusWorker;
