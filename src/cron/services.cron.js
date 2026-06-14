const cron = require('node-cron');
const smmService = require('../services/smm.service');
const logger = require('../utils/logger');

function initServicesCron() {
  // Refresh services cache every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('[CRON] Mulai background sync daftar services SMM...');
      await smmService.getServices(true);
    } catch (error) {
      logger.error('[CRON] Gagal background sync services:', error.message);
    }
  });

  // Jalankan asinkron sekali saat startup
  setTimeout(async () => {
    try {
      if (smmService.apiUrl && smmService.apiKey) {
        logger.info('[STARTUP] Fetch initial services from provider...');
        await smmService.getServices(true);
      }
    } catch (error) {
      logger.error('[STARTUP] Gagal ambil initial services', error.message);
    }
  }, 0);
}

module.exports = initServicesCron;
