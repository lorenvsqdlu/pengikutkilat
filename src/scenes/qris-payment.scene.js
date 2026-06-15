const { Scenes, Markup } = require('telegraf');
const QrisService = require('../services/qris.service');
const { sendOrEdit } = require('../utils/ui');

const qrisPaymentScene = new Scenes.WizardScene(
    'QRIS_PAYMENT_SCENE',
    async (ctx) => {
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
        const qrisList = await QrisService.getActiveQris();
        if (qrisList.length === 0) {
            await sendOrEdit(ctx, '❌ Maaf, saat ini belum ada QRIS yang aktif. Silakan gunakan metode Pembayaran Lain (Manual/Bank/Lainnya).');
            return ctx.scene.leave();
        }

        await sendOrEdit(ctx, '📱 *PEMBAYARAN QRIS MANUAL*\n\nSilakan scan / upload salah satu QRIS berikut ke aplikasi e-Wallet atau m-Banking Anda.', { parse_mode: 'Markdown' });

        for (const qris of qrisList) {
            try {
                const imgUrl = `${process.env.APP_URL || 'http://localhost:3000'}${qris.qris_image}`;
                await ctx.replyWithPhoto({ url: imgUrl }, { caption: `✅ ${qris.qris_name}` });
            } catch (e) {
                // If it fails to send via URL, try sending local file
                try {
                    const localPath = require('path').join(__dirname, '../../', qris.qris_image);
                    await ctx.replyWithPhoto({ source: localPath }, { caption: `✅ ${qris.qris_name}` });
                } catch(e2) {
                    await ctx.reply(`❌ Gambar QRIS ${qris.qris_name} gagal dimuat.`);
                }
            }
        }

        await ctx.reply('Setelah transfer, wajib klik tombol di bawah ini:', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Saya Sudah Transfer (QRIS)', 'DEP_QRIS_CONFIRM')],
                [Markup.button.callback('❌ Batal', 'CANCEL')]
            ])
        });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;
        if (action === 'CANCEL') {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.reply('❌ Pembayaran QRIS dibatalkan.');
            return ctx.scene.leave();
        }
        if (action === 'DEP_QRIS_CONFIRM') {
            await ctx.answerCbQuery().catch(() => {});
            // Go to manual deposit flow with PaymentMethod "QRIS Manual"
            ctx.scene.enter('MANUAL_DEPOSIT_SCENE', { method: 'QRIS Manual' });
            return;
        }
    }
);

qrisPaymentScene.command('cancel', async (ctx) => {
    await ctx.reply('❌ Batal.');
    return ctx.scene.leave();
});

module.exports = qrisPaymentScene;
