const { Telegraf, session, Scenes } = require('telegraf');
const config = require('../config');
const loggerMiddleware = require('../middlewares/logger.middleware');
const errorMiddleware = require('../middlewares/error.middleware');
const rateLimitMiddleware = require('../middlewares/ratelimit.middleware');

const setupStartCommand = require('../commands/start');
const setupUserCommands = require('../commands/user');
const orderScene = require('../scenes/order.scene');
const depositScene = require('../scenes/deposit.scene');
const qrisPaymentScene = require('../scenes/qris-payment.scene');
const adminQrisScene = require('../scenes/admin-qris.scene');
const { manualDepositScene, rejectDepositScene } = require('../scenes/deposit-manual.scene');
const { adminBankScene } = require('../scenes/admin-bank.scene');
const { adminBroadcastScene, adminMarkupScene, adminBalanceScene, adminBanScene } = require('../scenes/admin.scenes');
const adminMiddleware = require('../middlewares/admin.middleware');
const authMiddleware = require('../middlewares/auth.middleware');
const AdminController = require('../controllers/admin.controller');
const DepositController = require('../controllers/deposit.controller');

// Initialize Bot
const bot = new Telegraf(config.BOT_TOKEN || 'DUMMY_TOKEN_PREVENT_CRASH');

// Middlewares
bot.use(session());
bot.use(rateLimitMiddleware); // Proteksi spam
bot.use(authMiddleware);
bot.use(loggerMiddleware); // Pindahkan logger ke atas (setelah session)

const stage = new Scenes.Stage([
  orderScene, 
  depositScene,
  qrisPaymentScene,
  adminQrisScene,
  manualDepositScene,
  rejectDepositScene,
  adminBankScene,
  adminBroadcastScene, 
  adminMarkupScene, 
  adminBalanceScene, 
  adminBanScene
]);
bot.use(stage.middleware());

// Commands Routing
setupStartCommand(bot);

setupUserCommands(bot);

bot.command('order', (ctx) => ctx.scene.enter('ORDER_SCENE'));
bot.command('deposit', (ctx) => ctx.scene.enter('DEPOSIT_SCENE'));
bot.command('riwayat_deposit', DepositController.handleHistory);

// Admin Routes Hook
bot.command('admin', adminMiddleware, AdminController.handleAdminMenu);
bot.command('profit', adminMiddleware, AdminController.handleProfit);
bot.command('margin', adminMiddleware, AdminController.handleMargin);
bot.action(/ADMIN_.*/, adminMiddleware, AdminController.handleCallback);
bot.action(/DEP_(APPROVE|REJECT)_.*/, adminMiddleware, AdminController.handleCallback);

// Global Error Handling
bot.catch(errorMiddleware);

module.exports = bot;
