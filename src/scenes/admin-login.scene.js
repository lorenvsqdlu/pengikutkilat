const { Scenes, Markup } = require('telegraf');

const adminLoginScene = new Scenes.WizardScene(
  'ADMIN_LOGIN_SCENE',
  async (ctx) => {
    await ctx.reply(
      `🔐 *SECURE ADMINISTRATOR LOGIN*\n\nUntuk mengakses Panel Administrator, masukkan PIN keamanan Anda.\n\n⏳ Masa aktif sesi: 20 menit\n🛡 Sistem akan keluar otomatis setelah sesi berakhir.\n\nSilakan kirim PIN Administrator:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return;
    
    // Only text is allowed
    const enteredPin = ctx.message.text.trim();
    const correctPin = process.env.ADMIN_PIN;

    // Delete user's message containing PIN for security
    try {
        await ctx.deleteMessage(ctx.message.message_id);
    } catch(e) {}

    if (!correctPin) {
        await ctx.reply('⚠️ Sistem belum dikonfigurasi dengan aman. Variable environment ADMIN_PIN belum diatur di server.');
        return ctx.scene.leave();
    }

    if (enteredPin !== correctPin) {
      await ctx.reply('❌ PIN Administrator tidak valid.');
      // Stay in scene
      return;
    }

    // Success
    ctx.session = ctx.session || {};
    ctx.session.adminAuthenticated = true;
    ctx.session.adminLoginExpires = Date.now() + (20 * 60 * 1000);

    await ctx.reply('✅ Verifikasi berhasil.\n🔓 Akses Administrator diberikan.');
    
    // Instead of importing AdminController directly here, which can cause circular dependencies,
    // let's just leave the scene and re-trigger /admin
    await ctx.scene.leave();
    
    const AdminController = require('../controllers/admin.controller');
    return AdminController.handleAdminMenu(ctx);
  }
);

adminLoginScene.command('cancel', async (ctx) => {
    await ctx.reply('Login Administrator dibatalkan.');
    return ctx.scene.leave();
});

module.exports = adminLoginScene;