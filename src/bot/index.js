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
const { manualDepositScene, manualDepositProofScene, rejectDepositScene } = require('../scenes/deposit-manual.scene');
const { adminBankScene, adminToggleBankScene } = require('../scenes/admin-bank.scene');
const { adminDanaScene, adminDepQrisScene } = require('../scenes/admin-dana.scene');
const { adminBroadcastScene, adminMarkupScene, adminBalanceScene, adminBanScene } = require('../scenes/admin.scenes');
const { adminSetWelcomeScene, adminForceSubScene } = require('../scenes/admin.settings.scene');
const searchServicesScene = require('../scenes/search-services.scene');
const adminLoginScene = require('../scenes/admin-login.scene');
const adminMiddleware = require('../middlewares/admin.middleware');
const authMiddleware = require('../middlewares/auth.middleware');
const AdminController = require('../controllers/admin.controller');
const DepositController = require('../controllers/deposit.controller');
const UserController = require('../controllers/user.controller');

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
  manualDepositProofScene,
  rejectDepositScene,
  adminBankScene,
  adminToggleBankScene,
  adminDanaScene,
  adminDepQrisScene,
  adminBroadcastScene, 
  adminMarkupScene, 
  adminBalanceScene, 
  adminBanScene,
  adminSetWelcomeScene,
  adminForceSubScene,
  searchServicesScene,
  adminLoginScene
]);
bot.use(stage.middleware());

// Commands Routing
setupStartCommand(bot);

setupUserCommands(bot);

bot.command('order', (ctx) => ctx.scene.enter('ORDER_SCENE'));
bot.command('deposit', (ctx) => ctx.scene.enter('DEPOSIT_SCENE'));
bot.command('riwayat_deposit', DepositController.handleHistory);

// General user action handlers from main menu
bot.action('menu_order', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('ORDER_SCENE');
});
bot.action('menu_services', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await UserController.handleServices(ctx);
});
bot.action('menu_deposit', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('DEPOSIT_SCENE');
});
bot.action('menu_history', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await DepositController.handleHistory(ctx);
});
bot.action('menu_profile', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await UserController.handleProfile(ctx);
});
bot.action('menu_balance', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await UserController.handleSaldo(ctx);
});
bot.action('menu_refill', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const { Markup } = require('telegraf');
    const text = `♻️ *REQUEST REFILL*\n\nSilakan gunakan perintah berikut untuk melakukan refill pada order Anda:\n\n\`/refill <ID Order>\`\n\nContoh:\n\`/refill 123456\``;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📜 Riwayat Refill', 'menu_refill_history_1')],
        [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
      ])
    }).catch(() => {});
  } catch (e) {
    logger.error(`[REFILL ERROR]\nUser ID: ${ctx.from?.id}\nUsername: ${ctx.from?.username}\nCallback Data: menu_refill\nError: ${e.message}\nStack: ${e.stack}`);
  }
});
bot.action('back_to_menu_main', async (ctx) => {
  const StartController = require('../controllers/start.controller');
  await StartController.handleBackToMain(ctx);
});

bot.action('menu_informasi_ketentuan', async (ctx) => {
  const StartController = require('../controllers/start.controller');
  await StartController.handleInformasiKetentuan(ctx);
});

const RefillController = require('../controllers/refill.controller');
bot.action(/^refill_order_(\d+)$/, RefillController.handleRefillCallback);
bot.action(/^menu_refill_history_(\d+)$/, RefillController.handleRefillHistory);
bot.action(/^menu_services_(\d+)$/, UserController.handleServices);
bot.action(/^search_services$/, (ctx) => { ctx.answerCbQuery().catch(()=>{}); return ctx.scene.enter('SEARCH_SERVICES_SCENE'); });

bot.action(/^menu_order_history_(\d+)$/, UserController.handleOrderHistory);
bot.action(/^order_detail_(\d+)$/, UserController.handleOrderDetail);
bot.action(/^refresh_order_(\d+)$/, UserController.handleRefreshOrder);

// Admin Routes Hook
bot.command('admin', adminMiddleware, AdminController.handleAdminMenu);
bot.command('logoutadmin', (ctx) => {
    const adminIds = config.ADMIN_IDS.split(',').map(id => id.trim());
    if (!ctx.from || !adminIds.includes(ctx.from.id.toString())) return;

    if (ctx.session) {
        ctx.session.adminAuthenticated = false;
        ctx.session.adminLoginExpires = null;
    }
    return ctx.reply('✅ Sesi Administrator berhasil diakhiri.');
});
bot.command('profit', adminMiddleware, AdminController.handleProfit);
bot.command('margin', adminMiddleware, AdminController.handleMargin);
bot.command('approve', adminMiddleware, AdminController.handleApprove);
bot.command('reject', adminMiddleware, AdminController.handleReject);
bot.action(/ADMIN_.*/, adminMiddleware, AdminController.handleCallback);
bot.action(/DEP_(APPROVE|REJECT)_.*/, adminMiddleware, AdminController.handleCallback);

// Global Error Handling
bot.catch(errorMiddleware);

// Welcome message handler
bot.on('new_chat_members', async (ctx) => {
    try {
        const AdminService = require('../services/admin.service');
        const isEnabled = await AdminService.getSetting('welcome_enabled') === 'true';
        if (!isEnabled) return;
        
        let template = await AdminService.getSetting('welcome_message');
        if (!template) return;
        
        for (const member of ctx.message.new_chat_members) {
            if (member.is_bot) continue;
            
            let message = template
                .replace(/{first_name}/g, member.first_name || '')
                .replace(/{last_name}/g, member.last_name || '')
                .replace(/{username}/g, member.username ? '@' + member.username : '')
                .replace(/{id}/g, member.id || '');
                
            await ctx.reply(message);
        }
    } catch(e) {
        // Just silent ignore
    }
});

module.exports = bot;
