const { Scenes, Markup } = require('telegraf');
const db = require('../database');
const { sendOrEdit } = require('../utils/ui');

const adminDanaScene = new Scenes.WizardScene(
  'ADMIN_DEP_DANA_SCENE',
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await sendOrEdit(ctx, '🔵 *Ubah Nomor DANA*\n\nMasukkan nomor DANA beserta atas nama, misalnya:\n`081234567890 a.n Budi Santoso`\n\nAtau balas "TIDAK TERSEDIA" jika ingin menonaktifkannya.\n\nKetik /cancel untuk membatalkan.', { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'CANCEL')]])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL') {
      await ctx.answerCbQuery().catch(() => {});
      await sendOrEdit(ctx, '❌ Batal.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
      return ctx.scene.leave();
    }
    if (ctx.message && ctx.message.text) {
        if (ctx.message.text === '/cancel') {
            await ctx.reply('❌ Batal.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
            return ctx.scene.leave();
        }
        
        const noDana = ctx.message.text;
        await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('deposit_dana_number', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?`, [noDana, noDana]);
        
        await ctx.reply('✅ Nomor DANA berhasil diubah!', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
        return ctx.scene.leave();
    }
  }
);
adminDanaScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


const adminDepQrisScene = new Scenes.WizardScene(
  'ADMIN_DEP_QRIS_SCENE',
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await sendOrEdit(ctx, '🖼 *Ubah QRIS (Static)*\n\nSilakan kirimkan FOTO QRIS terbaru Anda.', { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'CANCEL')]])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL') {
      await ctx.answerCbQuery().catch(() => {});
      await sendOrEdit(ctx, '❌ Batal.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
      return ctx.scene.leave();
    }
    if (ctx.message?.text === '/cancel') {
        await ctx.reply('❌ Batal.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
        return ctx.scene.leave();
    }
    if (ctx.message && ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;
        
        await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('deposit_qris_file_id', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?`, [fileId, fileId]);
        
        await ctx.reply('✅ File QRIS berhasil diubah!', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_SETTINGS')]]) });
        return ctx.scene.leave();
    } else if (ctx.message) {
        await ctx.reply('Mohon kirimkan gambar/foto QRIS, atau ketik /cancel.');
        return;
    }
  }
);
adminDepQrisScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

module.exports = { adminDanaScene, adminDepQrisScene };
