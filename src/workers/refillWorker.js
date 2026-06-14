const { refillQueue } = require('../queue');
const RefillService = require('../services/refill.service');
const smmService = require('../services/smm.service');
const logger = require('../utils/logger');

let bot;

// Periodically fetch active refills and push to queue
setInterval(async () => {
    try {
        const activeRefills = await RefillService.getActiveRefills();
        refillQueue.queue = [];
        
        for (const refill of activeRefills) {
            refillQueue.push(refill);
        }
        if (refillQueue.length() > 0) {
           // logger.info(`[REFILL WORKER] Added ${refillQueue.length()} pending refills to queue.`);
        }
    } catch (e) {
        logger.error('[REFILL WORKER] Error fetching active refills', e);
    }
}, 120000); // Check every 2 mins

async function startRefillWorker(telegramBot) {
    bot = telegramBot;
    logger.info('[WORKER] Refill Worker started.');
    
    // Process 1 item every 800ms
    setInterval(async () => {
        const refill = refillQueue.shift();
        if (!refill) return;

        try {
            const apiData = await smmService.getRefillStatus(refill.api_refill_id);
            if (!apiData) return;
             
            const rawStatus = apiData.refill_status || apiData.status;
            if (!rawStatus || typeof rawStatus === 'boolean') return;
             
            const newStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
             
            if (newStatus !== refill.status && newStatus !== 'Pending' && newStatus !== 'Processing') {
                 await RefillService.updateRefillStatus(refill.id, newStatus);
                 logger.info(`[WORKER] Refill DB ID ${refill.id} berubah status -> ${newStatus}`);
                 
                 const notifyMsg = `🔄 *UPDATE STATUS REFILL*\n━━━━━━━━━━━━━━━━━\n*ID Refill API:* \`${refill.api_refill_id}\`\n*ID Order:* \`${refill.order_id}\`\n*Status Baru:* ${newStatus}\n━━━━━━━━━━━━━━━━━\nUpdate diberikan otomatis oleh sistem.`;
                 
                 try {
                     if(bot) await bot.telegram.sendMessage(refill.user_id, notifyMsg, { parse_mode: 'Markdown' });
                 } catch (e) {}
            }
        } catch (e) {
            logger.error(`[WORKER] Error check refill ${refill.id}: ${e.message}`);
        }
    }, 800);
}

module.exports = startRefillWorker;
