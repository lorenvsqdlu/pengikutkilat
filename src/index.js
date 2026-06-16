const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');

if (global.__BOT_RUNNING__) {
  process.exit(0);
}
global.__BOT_RUNNING__ = true;

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
const startReconciliationJob = require('./workers/financialReconciliation');

const app = express();

// Express configuration (To satisfy health checks / Web server requirements)
app.use(express.json());

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount Admin Web Dashboard (Deleted)
// No web admin dashboard. All manage by telegram bot.

app.get('/', (req, res) => {
  res.send('Telegram Bot Service is Running!');
});

app.get('/health', async (req, res) => {
  try {
    const db = require('./database/index');
    await db.pool.query('SELECT 1');
    res.status(200).json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", database: "disconnected" });
  }
});

// Start Server & Bot
app.listen(config.PORT, async () => {
  logger.info(`Express healthcheck service running on port ${config.PORT}`);

  const initDbWithRetry = async () => {
    try {
      const db = require('./database/index');
      await db.init();
      logger.info('Database Initialized.');
    } catch (err) {
      logger.error('Failed to initialize database. Operating in memory-only or stateless mode...');
      // Stop the loop completely
    }
  };
  initDbWithRetry();

  // Test SMM API Connection
  await smmService.testConnection();

  if (config.BOT_TOKEN) {
    let isWorkersStarted = false;

    // Launching the bot via long-polling with retry mechanism for zero-downtime deploys
    const launchBot = async (retries = 5) => {
      try {
        if (!isWorkersStarted) {
          // Base cron
          initServicesCron();
          
          // Background Queue Workers
          startOrderWorker(bot);
          startStatusWorker(bot);
          startRefillWorker(bot);
          startReconciliationJob(bot);
          isWorkersStarted = true;
        }

        bot.launch({ dropPendingUpdates: true }).then(() => {
          logger.info('Telegram Bot successfully launched via long-polling.');
        }).catch((err) => {
          if (err.response && err.response.error_code === 409 && retries > 0) {
            logger.warn(`Conflict 409 (another bot instance is running). Retrying in 5 seconds... (${retries} retries left)`);
            setTimeout(() => launchBot(retries - 1), 5000);
          } else {
            logger.error('Failed to launch Telegram Bot.', err);
          }
        });
      } catch (err) {
        logger.error('Error during bot launch sequence.', err);
      }
    };
    
    launchBot();

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    logger.warn('BOT_TOKEN is not defined in environment variables. Bot did not start.');
  }
});
