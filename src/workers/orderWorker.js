const { orderQueue } = require('../queue');
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
            // Re-queue pending order
            orderQueue.push({
               type: 'order',
               payload: {
                   order_id: order.id,
                   user_id: order.user_id,
                   price: order.price,
                   smm_payload: {
                       service: order.service_id,
                       target: order.target,
                       quantity: order.quantity
                   }
               }
            });
            count++;
        }
        if (count > 0) logger.info(`[WORKER] Auto-recovered ${count} pending orders from DB into queue.`);
    } catch (e) {
        logger.error('[WORKER] Failed to recover pending orders', e);
    }
}

async function processOrder(job) {
    try {
        await delay(300); // delay anti limit

        const { order_id, user_id, price, base_price, category, smm_payload } = job.payload;
        
        // Double balance check strictly before hitting API
        const user = await UserService.getUser(user_id);
        if (!user || parseFloat(user.balance) < parseFloat(price)) {
             await OrderService.updateOrderStatus(order_id, 'Canceled');
             throw new Error('Saldo tidak mencukupi saat proses dieksekusi.');
        }

        const res = await smmService.createOrder(smm_payload);

        if (res && (res.order || res.id || res.status === 'success' || res.status === true)) {
            const apiOrderId = res.order || res.id || res.order_id || 'N/A';
            
            // Deduct balance ONLY AFTER SUCCESS API
            await UserService.updateBalance(user_id, -price);

            // PROFIT ENGINE CALCULATION IN WORKER
            let sqlUpdates = [apiOrderId.toString(), 'Processing'];
            let sqlQuery = 'UPDATE orders SET api_order_id = ?, status = ?';
            
            if (base_price && smm_payload.quantity) {
                const ProfitEngine = require('../services/profit.engine');
                const calculated = await ProfitEngine.calculatePrice(base_price, smm_payload.quantity, category || '');
                sqlQuery += ', cost_price = ?, sell_price = ?, profit = ?';
                sqlUpdates.push(calculated.cost_price, calculated.sell_price, calculated.profit);
            }
            
            sqlQuery += ' WHERE id = ?';
            sqlUpdates.push(order_id);

            const db = require('../database');
            await db.query(sqlQuery, sqlUpdates);
            
            // Notifikasi sukses ke user
            const msg = `✅ *Order Diproses API!*\nID Order: \`${order_id}\`\nLayanan: ${smm_payload.service}\nTarget: ${smm_payload.target}\nHarga: Rp ${parseFloat(price).toLocaleString('id-ID')}\nSaldo telah dipotong.`;
            try { if (bot) await bot.telegram.sendMessage(user_id, msg, {parse_mode: 'Markdown'}); } catch(e){}
        } else {
            throw new Error(res.error || res.msg || 'SMM API gagal memproses order');
        }
    } catch (err) {
        job.attempts++;
        logger.error(`[Worker] Order ID ${job.payload.order_id} failed (Attempt ${job.attempts}): ${err.message}`);

        if (job.attempts < job.maxAttempts && err.message !== 'Saldo tidak mencukupi saat proses dieksekusi.') {
            await delay(job.attempts * 1000); // 1s, 2s, 3s delay
            orderQueue.push(job); // retry
        } else {
            // failed definitely
            await OrderService.updateOrderStatus(job.payload.order_id, 'Canceled');
            const msg = `❌ *Order Gagal Diproses*\nID Order: \`${job.payload.order_id}\`\nAlasan: ${err.message}\nSaldo Anda TIDAK dipotong.`;
            try { if (bot) await bot.telegram.sendMessage(job.payload.user_id, msg, {parse_mode: 'Markdown'}); } catch(e){}
        }
    }
}

function startOrderWorker(telegramBot) {
    bot = telegramBot;
    recoverPendingOrders();
    
    logger.info('[WORKER] Order Worker started.');
    setInterval(async () => {
        if (orderQueue.length() === 0) return;
        const job = orderQueue.shift();
        
        // Asynchronously process without blocking loop?
        // Let's await it to keep processing sequential
        await processOrder(job);
    }, 400); // 400ms interval checks
}

module.exports = startOrderWorker;
