const { Scenes, Markup } = require('telegraf');
const paymentService = require('../services/payment.service');
const DepositService = require('../services/deposit.service');
const BankService = require('../services/bank.service');
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
  await ctx.reply('❌ Deposit dibatalkan.', Markup.removeKeyboard());
  return ctx.scene.leave();
};

const depositScene = new Scenes.WizardScene(
  'DEPOSIT_SCENE',
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const banks = await BankService.getActiveBanks();
    let msg = '💰 *DEPOSIT SALDO*\n\nSilakan pilih metode deposit Anda:\n\n';
    msg += '1️⃣ *OTOMATIS (Sistem PG)* - Saldo langsung masuk\n(Minimal Rp 10.000, ada biaya per-transaksi)\n\n';
    msg += '2️⃣ *MANUAL TRANSFER BANK*\nTransfer ke salah satu rekening aktif kami:\n\n';
    
    if (banks.length > 0) {
        banks.forEach(b => {
            msg += `🏦 *${b.bank_name}*\n\`${b.account_number}\`\nA/N: ${b.account_name}\n\n`;
        });
    } else {
        msg += '_Belum ada rekening aktif._\n\n';
    }
    
    msg += '3️⃣ *QRIS MANUAL*\nScan QRIS milik kami (Pilih opsi Pembayaran QRIS untuk melihat QR).\n\n';
    msg += 'Setelah transfer Manual, pastikan klik tombol "Saya Sudah Transfer".';

    await sendOrEdit(ctx, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
          [Markup.button.callback('⚡ Deposit Otomatis (QRIS dll)', 'DEP_AUTO')],
          [Markup.button.callback('🏦 Saya Sudah Transfer (Bank)', 'DEP_MANUAL')],
          [Markup.button.callback('📱 Pembayaran QRIS / Sudah Scan', 'DEP_QRIS')],
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
      ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
      if (!ctx.callbackQuery) return;
      const action = ctx.callbackQuery.data;
      if (action === 'CANCEL') return handleCancel(ctx);
      
      if (action === 'DEP_MANUAL') {
          await ctx.answerCbQuery().catch(() => {});
          ctx.scene.enter('MANUAL_DEPOSIT_SCENE');
          return;
      }
      
      if (action === 'back_to_menu_main') {
          // It's technically caught globally but just in case
          const StartController = require('../controllers/start.controller');
          await StartController.handleBackToMain(ctx);
          return ctx.scene.leave();
      }

      if (action === 'DEP_QRIS') {
          await ctx.answerCbQuery().catch(() => {});
          ctx.scene.enter('QRIS_PAYMENT_SCENE');
          return;
      }
      
      if (action === 'DEP_AUTO') {
          await ctx.answerCbQuery().catch(() => {});
          await sendOrEdit(ctx, 'Masukkan nominal deposit otomatis yang Anda inginkan (Min: Rp 10.000).\nContoh: 50000\n\nKetik /cancel untuk membatalkan.');
          ctx.wizard.state.mode = 'AUTO';
          return ctx.wizard.next();
      }
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel') return handleCancel(ctx);
    if (!ctx.message || !ctx.message.text) return;
    
    if (ctx.wizard.state.mode === 'AUTO') {
        const amount = parseInt(ctx.message.text.replace(/[^0-9]/g, ''), 10);
        if (isNaN(amount) || amount < 10000) {
          await ctx.reply('❌ Nominal tidak valid. Minimal deposit adalah Rp 10.000. Silakan masukkan nominal yang benar.');
          return;
        }

        ctx.wizard.state.amount = amount;
        
        await ctx.reply(`Anda akan melakukan deposit otomatis sebesar *${formatRupiah(amount)}*.\nPilih metode pembayaran:`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Konfirmasi Pembayaran QRIS', 'CONFIRM_DEPOSIT')],
            [Markup.button.callback('❌ Batal', 'CANCEL')]
          ])
        });
        return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);

    if (action === 'CONFIRM_DEPOSIT') {
      await ctx.answerCbQuery().catch(() => {});
      const loadMsg = await ctx.reply('⏳ Sedang dihubungkan ke Payment Gateway...');

      try {
        const user = ctx.from;
        const amount = ctx.wizard.state.amount;
        
        const trx = await paymentService.createTransaction(user, amount, 'QRIS');

        await DepositService.createDeposit({
          user_id: user.id,
          reference_id: trx.reference,
          amount: amount, 
          fee: trx.total_fee || 0,
          status: 'Pending',
          payment_method: 'QRIS',
          pay_url: trx.qr_url || trx.checkout_url
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, loadMsg.message_id);

        const replyText = `
✅ *INVOICE PEMBAYARAN*
━━━━━━━━━━━━━━━━━
*Ref:* \`${trx.reference}\`
*Metode:* QRIS
*Nominal Deposit:* ${formatRupiah(amount)}
*Biaya (Fee):* ${formatRupiah(trx.total_fee || 0)}
*Total Pembayaran:* ${formatRupiah(trx.amount)}

Silakan scan QRIS pada tautan di bawah ini atau buka halaman checkout untuk membayar.
Saldo akan otomatis masuk setelah pembayaran terverifikasi.
`;

        await ctx.reply(replyText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
             [Markup.button.url('👉 Bayar di Sini', trx.checkout_url || trx.qr_url)]
          ])
        });

      } catch (error) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadMsg.message_id);
        await ctx.reply(`❌ Gagal membuat pembayaran: ${error.message}`);
      }

      return ctx.scene.leave();
    }
  }
);

depositScene.command('cancel', handleCancel);

module.exports = depositScene;
