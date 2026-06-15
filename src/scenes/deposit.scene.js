const { Scenes, Markup } = require('telegraf');
const DepositService = require('../services/deposit.service');
const AdminService = require('../services/admin.service');
const config = require('../config');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');

// Helper
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

const handleCancel = async (ctx) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await sendOrEdit(ctx, '❌ Deposit dibatalkan.', {
      ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
      ])
  });
  return ctx.scene.leave();
};

const depositScene = new Scenes.WizardScene(
  'DEPOSIT_SCENE',
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    
    let msg = '💰 *DEPOSIT MANUAL*\n\nPilih salah satu nominal cepat di bawah ini atau pilih "Nominal Lain" untuk memasukkan nominal khusus (Minimal Rp 10.000).';
    
    await sendOrEdit(ctx, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
          [Markup.button.callback('Rp10.000', 'AMT_10000'), Markup.button.callback('Rp20.000', 'AMT_20000')],
          [Markup.button.callback('Rp30.000', 'AMT_30000'), Markup.button.callback('Rp50.000', 'AMT_50000')],
          [Markup.button.callback('Rp100.000', 'AMT_100000'), Markup.button.callback('Rp200.000', 'AMT_200000')],
          [Markup.button.callback('Nominal Lain', 'AMT_CUSTOM')],
          [Markup.button.callback('🔙 Kembali', 'back_to_menu_main')]
      ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
      if (!ctx.callbackQuery) return;
      const action = ctx.callbackQuery.data;
      if (action === 'CANCEL') return handleCancel(ctx);
      
      if (action === 'back_to_menu_main') {
          await ctx.answerCbQuery().catch(() => {});
          const StartController = require('../controllers/start.controller');
          await StartController.handleBackToMain(ctx);
          return ctx.scene.leave();
      }
      
      if (action.startsWith('AMT_')) {
          await ctx.answerCbQuery().catch(() => {});
          
          if (action === 'AMT_CUSTOM') {
              ctx.wizard.state.mode = 'CUSTOM_AMOUNT';
              await sendOrEdit(ctx, 'Masukkan nominal transfer yang Anda kirim (contoh: 50000).\nMin: Rp 10.000\n\nKetik /cancel untuk membatalkan:');
              return ctx.wizard.next();
          }
          
          const amount = parseInt(action.replace('AMT_', ''), 10);
          ctx.wizard.state.amount = amount;
          return processInvoice(ctx, amount);
      }
      
      await ctx.answerCbQuery().catch(() => {});
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        return;
    }
    if (ctx.message?.text === '/cancel') return handleCancel(ctx);
    if (!ctx.message || !ctx.message.text) return;
    
    if (ctx.wizard.state.mode === 'CUSTOM_AMOUNT') {
        const amount = parseInt(ctx.message.text.replace(/[^0-9]/g, ''), 10);
        if (isNaN(amount) || amount < 10000) {
          await ctx.reply('❌ Nominal tidak valid. Minimal deposit adalah Rp 10.000. Silakan masukkan nominal yang benar.');
          return;
        }

        ctx.wizard.state.amount = amount;
        return processInvoice(ctx, amount);
    }
  }
);

depositScene.command('cancel', handleCancel);

async function processInvoice(ctx, amount) {
    const user = ctx.from;
    const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
    const refId = 'INV' + Date.now() + randomStr;
    
    // Save to DB
    await DepositService.createDeposit({
        user_id: user.id,
        reference_id: refId,
        amount: amount, 
        fee: 0,
        status: 'Pending',
        payment_method: 'Manual Payment',
        pay_url: ''
    });
    
    const dana_number = await AdminService.getSetting('deposit_dana_number') || 'TIDAK TERSEDIA';
    const gopay_number = await AdminService.getSetting('deposit_gopay_number') || 'TIDAK TERSEDIA';
    const ovo_number = await AdminService.getSetting('deposit_ovo_number') || 'TIDAK TERSEDIA';
    const bca_account = await AdminService.getSetting('deposit_bca_account') || 'TIDAK TERSEDIA';
    const qris_file_id = await AdminService.getSetting('deposit_qris_file_id') || null;

    const captionText = `💳 *PILIHAN PEMBAYARAN MANUAL*

Silakan transfer sesuai nominal ke salah satu rekening berikut:

💰 Nominal: *${formatRupiah(amount)}*
📱 QRIS: Scan QR di atas

🔵 DANA
${dana_number}

🟢 GOPAY
${gopay_number}

🟣 OVO
${ovo_number}

🏦 BCA
${bca_account}

🧾 Invoice:
\`${refId}\`

👉 *Instruksi:*
1. Pilih salah satu metode pembayaran.
2. Transfer sesuai nominal.
3. Kirim foto/screenshot bukti transfer ke chat ini sekarang.
4. Admin akan melakukan verifikasi secara manual.

⏳ Status:
*MENUNGGU BUKTI PEMBAYARAN*`;

    // Exit old message
    try {
      await ctx.deleteMessage();
    } catch(e) {}
    
    if (qris_file_id) {
        await ctx.replyWithPhoto(qris_file_id, {
            caption: captionText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[Markup.button.callback('❌ Batal', 'CANCEL_DEPOSIT_INV')]]
            }
        });
    } else {
        await ctx.reply(captionText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[Markup.button.callback('❌ Batal', 'CANCEL_DEPOSIT_INV')]]
            }
        });
    }
    
    // Switch to manual scene to wait for photo
    return ctx.scene.enter('MANUAL_DEPOSIT_PROOF_SCENE', { reference_id: refId, amount });
}

module.exports = depositScene;
