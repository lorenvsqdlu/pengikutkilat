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
const initOrderCron = require('./cron/order-status.cron');

const app = express();

// Express configuration (To satisfy health checks / Web server requirements)
app.use(express.json());

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount Admin Web Dashboard
const adminApp = require('./admin/app');
app.use('/admin', adminApp);

app.get('/', (req, res) => {
  res.send('Telegram Bot Service is Running!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Tripay Webhook Endpoint
app.post('/webhook/tripay', async (req, res) => {
  try {
    const signature = req.headers['x-callback-signature'];
    const paymentService = require('./services/payment.service');
    const DepositService = require('./services/deposit.service');
    const UserService = require('./services/user.service');

    if (!paymentService.verifyCallback(req.body, signature)) {
      logger.warn('Webhook Error: Invalid Tripay signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const { reference, merchant_ref, status, total_amount } = req.body;
    
    // Pastikan reference prefix kita (DEP-)
    if (!merchant_ref || !merchant_ref.startsWith('DEP-')) {
       return res.status(200).json({ success: true, message: 'Not a deposit transaction' });
    }
    
    // Cegah double callback
    const deposit = await DepositService.getDepositByRef(merchant_ref);
    if (!deposit) {
      logger.warn(`Webhook Error: Deposit not found for ref ${merchant_ref}`);
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }
    if (deposit.status === 'Paid') {
       return res.status(200).json({ success: true, message: 'Already paid' });
    }

    if (status === 'PAID') {
       await DepositService.updateDepositStatus(merchant_ref, 'Paid');
       await UserService.updateBalance(deposit.user_id, deposit.amount);
       
       // Notifikasi
       try {
         await bot.telegram.sendMessage(deposit.user_id, `✅ <b>DEPOSIT BERHASIL</b>\n\nRef: <code>${merchant_ref}</code>\nJumlah: Rp ${new Intl.NumberFormat('id-ID').format(deposit.amount)}\n\nSaldo Anda telah ditambahkan!`, { parse_mode: 'HTML' });
       } catch(e) {
         logger.warn(`Failed to send notification to ${deposit.user_id}`);
       }
       logger.info(`Deposit Paid: ${merchant_ref} for amount ${deposit.amount}`);
       
    } else if (status === 'EXPIRED' || status === 'FAILED') {
       await DepositService.updateDepositStatus(merchant_ref, 'Failed');
       logger.info(`Deposit Failed/Expired: ${merchant_ref}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Webhook Endpoint Error', err);
    return res.status(500).json({ success: false });
  }
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
        // Jalankan Cron Job Auto Update Order
        initOrderCron(bot);
      })
      .catch(err => logger.error('Failed to launch Telegram Bot.', err));

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    logger.warn('BOT_TOKEN is not defined in environment variables. Bot did not start.');
  }
});
