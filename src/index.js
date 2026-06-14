const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const bot = require('./bot');
const smmService = require('./services/smm.service');
const initServicesCron = require('./cron/services.cron');

// Import Workers
const startOrderWorker = require('./workers/orderWorker');
const startStatusWorker = require('./workers/statusWorker');
const startRefillWorker = require('./workers/refillWorker');

const app = express();

// Express configuration (To satisfy health checks / Web server requirements)
app.use(express.json());

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount Admin Web Dashboard (Disabled per configuration)
// const adminApp = require('./admin/app');
// app.use('/admin', adminApp);

app.get('/', (req, res) => {
  res.send('Telegram Bot Service is Running!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start Server & Bot
app.listen(config.PORT, async () => {
  logger.info(`Express healthcheck service running on port ${config.PORT}`);

  // Test SMM API Connection
  await smmService.testConnection();

  if (config.BOT_TOKEN) {
    // Launching the bot via long-polling
    bot.launch()
      .then(() => {
        logger.info('Telegram Bot successfully launched via long-polling.');
        // Base cron
        initServicesCron();
        
        // Background Queue Workers
        startOrderWorker(bot);
        startStatusWorker(bot);
        startRefillWorker(bot);
      })
      .catch(err => logger.error('Failed to launch Telegram Bot.', err));

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    logger.warn('BOT_TOKEN is not defined in environment variables. Bot did not start.');
  }
});
