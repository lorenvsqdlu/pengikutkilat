const { Scenes, Markup } = require('telegraf');
const DepositService = require('../services/deposit.service');
const AdminService = require('../services/admin.service');
const config = require('../config');
const db = require('../database');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');

const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

const manualDepositProofScene = new Scenes.WizardScene(
  'MANUAL_DEPOSIT_PROOF_SCENE',
  async (ctx) => {
    // Only listening for photo
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL_DEPOSIT_INV') {
        await ctx.answerCbQuery().catch(() => {});
        const refId = ctx.scene.state.reference_id;
        if (refId) {
             await db.query('UPDATE deposits SET status = ? WHERE reference_id = ?', ['Canceled', refId]);
        }
        await ctx.reply('❌ Batal deposit.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        return ctx.scene.leave();
    }

    if (ctx.message?.text === '/cancel') {
        const refId = ctx.scene.state.reference_id;
        if (refId) {
             await db.query('UPDATE deposits SET status = ? WHERE reference_id = ?', ['Canceled', refId]);
        }
        await ctx.reply('❌ Batal.', {
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
            ])
        });
        return ctx.scene.leave();
    }
    
    if (ctx.message && !ctx.message.photo) {
      await ctx.reply('❌ Silakan kirim screenshot/foto bukti transfer.');
      return;
    }
    
    if (ctx.message && ctx.message.photo) {
        const processingMsg = await ctx.reply('⏳ Sedang memproses bukti transfer...');
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;
        
        const refId = ctx.scene.state.reference_id;
        const amount = ctx.scene.state.amount;

        try {
            // Save file_id as proof and WAITING_APPROVAL
            await db.query(`UPDATE deposits SET proof_image = ?, status = 'WAITING_APPROVAL' WHERE reference_id = ?`, [fileId, refId]);
            
            // Notify Admins
            const adminIds = config.ADMIN_IDS.split(',').map(id => id.trim()).filter(id => id);
            for(let adminId of adminIds) {
                try {
                   await ctx.telegram.sendPhoto(adminId, fileId, {
                       caption: `🚨 *DEPOSIT PENDING (WAITING_APPROVAL)*\n\nRef: \`${refId}\`\nUser: @${ctx.from.username || ctx.from.id}\nNominal: *${formatRupiah(amount)}*`,
                       parse_mode: 'Markdown',
                       ...Markup.inlineKeyboard([
                           [Markup.button.callback('💳 Kelola Deposit', 'ADMIN_DEPOSIT_PENDING')]
                       ])
                   });
                } catch(e) {}
            }
            
            await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, undefined, 
              `✅ *Bukti Transfer Berhasil Dikirim!*\n\nInvoice: \`${refId}\`\nStatus: *MENUNGGU BUKTI PEMBAYARAN* (Verifikasi)\n\nAdmin akan segera memeriksa deposit Anda.`, {
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
  }
);
manualDepositProofScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

const rejectDepositScene = new Scenes.WizardScene(
    'REJECT_DEPOSIT_SCENE',
    async (ctx) => {
        await ctx.reply(`Masukkan alasan penolakan deposit untuk Invoice: ${ctx.scene.state.reference_id}\n(Ketik /cancel untuk batal)`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.reply('Batal.');
            return ctx.scene.leave();
        }
        const reason = ctx.message?.text;
        const refId = ctx.scene.state.reference_id;
        
        try {
            const deposit = await DepositService.getDepositByRef(refId);
            if(!deposit || (deposit.status !== 'Pending' && deposit.status !== 'WAITING_APPROVAL')) {
                await ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
                return ctx.scene.leave();
            }
            
            const updated = await DepositService.updateDepositStatus(refId, 'REJECTED', ctx.from.id);
            if (!updated) {
                await ctx.reply('❌ Deposit sudah diproses admin lain.');
                return ctx.scene.leave();
            }
            // Update the logs as well
            const logger = require('../utils/logger');
            logger.info(`[DEPOSIT] rejected by admin ${ctx.from.id} for ref ${refId}`);
            await AdminService.logAction(ctx.from.id, 'REJECT_DEPOSIT', { reference_id: refId, reason });
            
            await ctx.reply(`✅ Deposit ${refId} berhasil direject.`, {
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Deposit', 'ADMIN_DEPOSIT_PENDING')]])
            });
            
            try {
                await ctx.telegram.sendMessage(deposit.user_id, `❌ *Deposit Ditolak*\n\nInvoice: \`${refId}\`\n\nSilakan hubungi admin jika merasa terjadi kesalahan.`, { parse_mode: 'Markdown' });
            } catch(e){}
            
        } catch (e) {
            await ctx.reply('Terjadi kesalahan.');
        }
        return ctx.scene.leave();
    }
);
rejectDepositScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

// Empty scene just to not break things if called from somewhere else previously
const manualDepositScene = new Scenes.WizardScene('MANUAL_DEPOSIT_SCENE', async(ctx) => {
   await sendOrEdit(ctx, 'Gunakan menu deposit yang baru.');
   return ctx.scene.leave();
});

module.exports = { manualDepositScene, manualDepositProofScene, rejectDepositScene };
