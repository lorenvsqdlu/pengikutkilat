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

    const db = require('../database');
    const [userRows] = await db.query('SELECT * FROM users WHERE telegram_id = ?', [ctx.from.id]);
    if (!userRows || userRows.length === 0) {
        await ctx.reply('❌ Anda belum terdaftar.');
        return ctx.scene.leave();
    }
    
    const user = userRows[0];
    if (user.admin_lock_until && new Date(user.admin_lock_until) > new Date()) {
        await ctx.reply(`🚫 Terlalu banyak percobaan gagal. Akun dikunci sementara dari login admin hingga:\n${new Date(user.admin_lock_until).toLocaleString('id-ID')}`);
        return ctx.scene.leave();
    }

    if (!correctPin) {
        await ctx.reply('⚠️ Sistem belum dikonfigurasi dengan aman. Variable environment ADMIN_PIN belum diatur di server.');
        return ctx.scene.leave();
    }

    if (enteredPin !== correctPin) {
      const attempts = (user.admin_login_attempts || 0) + 1;
      if (attempts >= 5) {
          // Lock for 30 mins
          await db.query(`UPDATE users SET admin_login_attempts = 0, admin_lock_until = NOW() + INTERVAL '30 minutes' WHERE telegram_id = ?`, [ctx.from.id]);
          await ctx.reply('🚨 Terlalu banyak percobaan gagal. Akses diblokir selama 30 menit. Insiden keamanan ini dicatat.');
          // You could also log this security incident to a telegram log channel here
          return ctx.scene.leave();
      } else {
          await db.query(`UPDATE users SET admin_login_attempts = ? WHERE telegram_id = ?`, [attempts, ctx.from.id]);
          await ctx.reply(`❌ PIN Administrator tidak valid. Percobaan tersisa: ${5 - attempts}`);
          return;
      }
    }

    // Success
    await db.query(`UPDATE users SET admin_login_attempts = 0, admin_lock_until = NULL WHERE telegram_id = ?`, [ctx.from.id]);
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