const { Scenes, Markup } = require('telegraf');
const BankService = require('../services/bank.service');
const DepositService = require('../services/deposit.service');
const AdminService = require('../services/admin.service');
const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');

const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

async function downloadFile(url, filename) {
  const saveDir = path.join(__dirname, '../../uploads/deposits');
  if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
  }
  const savePath = path.join(saveDir, filename);
  const writer = fs.createWriteStream(savePath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(`/uploads/deposits/${filename}`));
    writer.on('error', reject);
  });
}

const manualDepositScene = new Scenes.WizardScene(
  'MANUAL_DEPOSIT_SCENE',
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    await sendOrEdit(ctx, '💰 *DEPOSIT MANUAL*\n\nMasukkan nominal transfer yang Anda kirim (contoh: 50000).\nMin: Rp 10.000\n\nKetik /cancel untuk membatalkan:', { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Batal', 'CANCEL')]
      ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL') {
        await ctx.answerCbQuery().catch(() => {});
        await sendOrEdit(ctx, '❌ Batal deposit.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        return ctx.scene.leave();
    }
    if (ctx.message?.text === '/cancel') {
        await ctx.reply('❌ Batal.', {
             ...Markup.inlineKeyboard([
                  [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
             ]
        )});
        return ctx.scene.leave();
    }
    const amount = parseInt(ctx.message?.text?.replace(/[^0-9]/g, ''), 10);
    if (isNaN(amount) || amount < 10000) {
      await ctx.reply('❌ Nominal tidak valid. Minimal Rp 10.000. Coba lagi.');
      return;
    }
    ctx.wizard.state.amount = amount;
    
    await ctx.reply(`Anda akan deposit sebesar *${formatRupiah(amount)}*.\n\n📸 Silakan kirimkan (Upload) *Bukti Transfer* Anda sekarang:\nUpload sebagai gambar.`, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Batal', 'CANCEL')]
        ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL') {
        await ctx.answerCbQuery().catch(() => {});
        await sendOrEdit(ctx, '❌ Batal deposit.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        return ctx.scene.leave();
    }
    if (ctx.message?.text === '/cancel') {
        await ctx.reply('❌ Batal.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        return ctx.scene.leave();
    }
    
    if (!ctx.message || !ctx.message.photo) {
      await ctx.reply('❌ Mohon kirimkan / upload gambar bukti transfer Anda.');
      return;
    }
    
    const processingMsg = await ctx.reply('⏳ Sedang memproses deposit Anda...\nMohon tunggu.');
    
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    
    try {
        const fileUrl = await ctx.telegram.getFileLink(fileId);
        const filename = `dep_${Date.now()}_${ctx.from.id}.jpg`;
        const localPath = await downloadFile(fileUrl.href, filename);
        
        const reference_id = 'MANUAL-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        
        await DepositService.createDeposit({
            user_id: ctx.from.id,
            reference_id,
            amount: ctx.wizard.state.amount,
            fee: 0,
            status: 'Pending',
            payment_method: ctx.scene.state.method || 'Manual Transfer',
            pay_url: '',
            proof_image: `/uploads/deposits/${filename}`
        });
        
        // Notify Admins
        const methodDisplay = ctx.scene.state.method || 'Manual Transfer';
        const adminIds = config.ADMIN_IDS.split(',').map(id => id.trim()).filter(id => id);
        for(let adminId of adminIds) {
            try {
               await ctx.telegram.sendPhoto(adminId, fileId, {
                   caption: `🚨 *DEPOSIT PENDING BARU*\n\nUser: @${ctx.from.username || ctx.from.id}\nUID: \`${ctx.from.id}\`\nRef: \`${reference_id}\`\nNominal: *${formatRupiah(ctx.wizard.state.amount)}*\nMetode: ${methodDisplay}`,
                   parse_mode: 'Markdown',
                   ...Markup.inlineKeyboard([
                       [Markup.button.callback('✅ Approve', `DEP_APPROVE_${reference_id}`)],
                       [Markup.button.callback('❌ Reject', `DEP_REJECT_${reference_id}`)]
                   ])
               });
            } catch(e) {}
        }
        
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, 
          `✅ *Tiket Deposit Berhasil Dibuat!*\n\nRef: \`${reference_id}\`\nNominal: *${formatRupiah(ctx.wizard.state.amount)}*\n\nMohon tunggu admin memverifikasi bukti. Saldo akan masuk setelah disetujui.`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        
    } catch(err) {
        logger.error('Manual Deposit Error', err);
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, '❌ Terjadi kesalahan saat memproses deposit manual. Hubungi admin.');
    }
    return ctx.scene.leave();
  }
);
manualDepositScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

const rejectDepositScene = new Scenes.WizardScene(
    'REJECT_DEPOSIT_SCENE',
    async (ctx) => {
        await ctx.reply(`Masukkan alasan penolakan deposit untuk Ref: ${ctx.scene.state.reference_id}\n(Ketik /cancel untuk batal)`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.reply('Batal.');
            return ctx.scene.leave();
        }
        const reason = ctx.message?.text;
        const refId = ctx.scene.state.reference_id;
        
        const deposit = await DepositService.getDepositByRef(refId);
        if(!deposit || deposit.status !== 'Pending') {
            await ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
            return ctx.scene.leave();
        }
        
        const updated = await DepositService.updateDepositStatus(refId, 'Rejected', ctx.from.id);
        if (!updated) {
            await ctx.reply('❌ Deposit sudah diproses admin lain.');
            return ctx.scene.leave();
        }
        await AdminService.logAction(ctx.from.id, 'REJECT_DEPOSIT', { reference_id: refId, reason });
        
        await ctx.reply(`✅ Deposit ${refId} berhasil direject.`, {
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Admin', 'ADMIN_MENU')]])
        });
        
        try {
            await ctx.telegram.sendMessage(deposit.user_id, `❌ *DEPOSIT DITOLAK*\n\nRef: \`${refId}\`\nNominal: ${formatRupiah(deposit.amount)}\nAlasan: ${reason}`, { parse_mode: 'Markdown' });
        } catch(e){}
        
        return ctx.scene.leave();
    }
);
rejectDepositScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

module.exports = { manualDepositScene, rejectDepositScene };
