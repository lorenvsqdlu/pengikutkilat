const QueueService = require('../services/queue.service');
const smmService = require('../services/smm.service');
const OrderService = require('../services/order.service');
const UserService = require('../services/user.service');
const logger = require('../utils/logger');
let bot;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function recoverPendingOrders() {
    try {
        const db = require('../database');
        const [pending] = await db.query("SELECT * FROM orders WHERE status = 'Pending'");
        let count = 0;
        for (const order of pending) {
            // Check if already in queue
            const [q] = await db.query("SELECT id FROM orders_queue WHERE order_id = ?", [order.id]);
            if (!q || q.length === 0) {
                 await QueueService.pushOrder({
                     order_id: order.id,
                     user_id: order.user_id,
                     price: order.price,
                     base_price: order.cost_price ? order.cost_price / order.quantity : 0,
                     category: order.category,
                     quantity: order.quantity,
                     smm_payload: {
                         service: order.service_id,
                         target: order.target,
                         quantity: order.quantity
                     }
                 });
                 count++;
            }
        }
        if (count > 0) logger.info(`[WORKER] Auto-recovered ${count} pending orders from DB into queue.`);
    } catch (e) {
        logger.error('[WORKER] Failed to recover pending orders', e);
    }
}

// Processing lock to prevent double execution
let isProcessing = false;

async function processOrder(job) {
    try {
        await delay(300); // delay anti limit

        // SQLite job format is slightly different 
        let { order_id, user_id, price, base_price, quantity, category, smm_payload } = job;
        
        price = Math.floor(Number(price || 0));
        quantity = Math.floor(Number(quantity || 0));
        
        // Check balance and deduct immediately to prevent race conditions
        const user = await UserService.getUser(user_id);
        if (!user || user.balance < price) {
             await OrderService.updateOrderStatus(order_id, 'Canceled');
             throw new Error('Saldo tidak mencukupi saat proses dieksekusi.');
        }

        const estimatedProviderCost = (job.base_price / 1000) * quantity;
        try {
            const providerBalanceRes = await smmService.getBalance();
            if (providerBalanceRes && providerBalanceRes.status && providerBalanceRes.balance !== undefined) {
               const pBalanceStr = providerBalanceRes.balance.toString().replace(/,/g, '');
               const pBalance = parseFloat(pBalanceStr);
               if (pBalance < estimatedProviderCost) {
                   await OrderService.updateOrderStatus(order_id, 'Canceled');
                   await QueueService.completeOrder(job.id);
                   throw new Error('Layanan sedang tidak tersedia (Saldo server limit), silakan coba beberapa saat lagi.');
               }
            }
        } catch(e) {
            if (e.message.includes('Layanan sedang tidak tersedia')) throw e;
        }

        // Deduct balance BEFORE hitting API
        await UserService.updateBalance(user_id, -price, 'Order', `Order SMM Service ${smm_payload.service}`, order_id.toString());

        let res;
        try {
            res = await smmService.createOrder(smm_payload);
        } catch (apiError) {
            // Is it a timeout or network error?
            const isTimeout = ['ETIMEDOUT', 'ECONNRESET', '502', '503', '504'].some(code => apiError.message.includes(code) || (apiError.code && apiError.code.includes(code)));
            
            if (isTimeout) {
                // Do not refund automatically for timeout. Mark for manual check.
                await OrderService.updateOrderStatus(order_id, 'MANUAL_CHECK');
                await QueueService.completeOrder(job.id);
                try { if (bot) await bot.telegram.sendMessage(user_id, `⚠️ *Peringatan Timeout Provider*\nID Order: \`${order_id}\`\nSistem SMM kami sedang padat, order Anda sedang di-"Manual Check" oleh admin. Saldo tertahan sementara menunggu konfirmasi dari provider.`, {parse_mode: 'Markdown'}); } catch(e){}
                throw new Error('Provider Timeout - MANUAL CHECK REQUIRED');
            } else {
                // Refund on critical API error that is defined
                await UserService.updateBalance(user_id, price, 'Refund', `API Error Order ${order_id}`, order_id.toString());
                throw apiError;
            }
        }

        if (res && (res.order || res.id || res.status === 'success' || res.status === true)) {
            const apiOrderId = res.order || res.id || res.order_id || 'N/A';

            // PROFIT ENGINE CALCULATION IN WORKER
            let sqlUpdates = [apiOrderId.toString(), 'Processing'];
            let sqlQuery = 'UPDATE orders SET api_order_id = ?, status = ?';
            
            if (base_price && quantity) {
                const ProfitEngine = require('../services/profit.engine');
                const calculated = await ProfitEngine.calculatePrice(base_price, quantity, category || '');
                sqlQuery += ', cost_price = ?, sell_price = ?, profit = ?';
                sqlUpdates.push(calculated.cost_price, calculated.sell_price, calculated.profit);
            }
            
            sqlQuery += ' WHERE id = ?';
            sqlUpdates.push(order_id);

            const db = require('../database');
            try {
                await db.query(sqlQuery, sqlUpdates);
            } catch (e) {
                if (e.message.includes('column') && e.message.includes('does not exist') && base_price && quantity) {
                    const logger = require('../utils/logger');
                    logger.warn('[SCHEMA CHECK] fallback enabled for orders table (cost_price/profit)');
                    const fallbackQuery = 'UPDATE orders SET api_order_id = ?, status = ? WHERE id = ?';
                    await db.query(fallbackQuery, [apiOrderId.toString(), 'Processing', order_id]);
                } else {
                    throw e;
                }
            }
            
            // Notifikasi sukses ke user
            const msg = `✅ *Order Diproses API!*\nID Order: \`${order_id}\`\nLayanan: ${smm_payload.service}\nTarget: ${smm_payload.target}\nHarga: Rp ${parseFloat(price).toLocaleString('id-ID')}\nSaldo telah dipotong.`;
            try { if (bot) await bot.telegram.sendMessage(user_id, msg, {parse_mode: 'Markdown'}); } catch(e){}
            
            await QueueService.completeOrder(job.id);
        } else {
            // SMM API returned logic error (e.g. invalid target, insufficient balance on provider)
            // MUST REFUND BALANCE!
            await UserService.updateBalance(user_id, price, 'Refund', `SMM API Gagal Memproses Order ${order_id}`, order_id.toString());
            throw new Error(res.error || res.msg || 'SMM API gagal memproses order');
        }
    } catch (err) {
        job.retry_count = (job.retry_count || 0) + 1;
        logger.error(`[Worker] Order ID ${job.order_id} failed (Attempt ${job.retry_count}): ${err.message}`);

        if (job.retry_count < 3 && err.message !== 'Saldo tidak mencukupi saat proses dieksekusi.') {
            await delay(job.retry_count * 1000); // 1s, 2s, 3s delay
            await QueueService.failOrder(job.id, job.retry_count);
        } else {
            // failed definitely
            await OrderService.updateOrderStatus(job.order_id, 'Canceled');
            const msg = `❌ *Order Gagal Diproses*\nID Order: \`${job.order_id}\`\nAlasan: ${err.message}\nSaldo Anda TIDAK dipotong.`;
            try { if (bot) await bot.telegram.sendMessage(job.user_id, msg, {parse_mode: 'Markdown'}); } catch(e){}
            
            await QueueService.completeOrder(job.id); // Remove from queue after definitive fail
        }
    }
}

function startOrderWorker(telegramBot) {
    bot = telegramBot;
    recoverPendingOrders();
    
    // Automatically recover zombie orders every 10 minutes (600000 ms)
    setInterval(async () => {
        try {
            const recoveredCount = await QueueService.recoverZombieOrders();
            if (recoveredCount > 0) {
                logger.info(`[WORKER] Recovered ${recoveredCount} zombie orders`);
            }
            const DepositService = require('../services/deposit.service');
            const expiredCount = await DepositService.expireDeposits();
            if (expiredCount > 0) {
                logger.info(`[WORKER] Expired ${expiredCount} deposits > 24 hours`);
            }
        } catch(e) {
            logger.error(`[WORKER] Failed to recover zombie orders: ${e.message}`);
        }
    }, 600000);

    logger.info('[WORKER] Order Worker started.');
    setInterval(async () => {
        if (isProcessing) return;
        isProcessing = true;
        
        try {
            const job = await QueueService.popOrder();
            if (job) {
                await processOrder(job);
            }
        } catch (err) {
            logger.error('[WORKER] Error popping job', err);
        } finally {
            isProcessing = false;
        }
    }, 500); // 500ms interval checks
}

module.exports = startOrderWorker;
