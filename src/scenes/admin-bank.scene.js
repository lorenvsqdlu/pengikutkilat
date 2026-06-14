const { Scenes, Markup } = require('telegraf');
const BankService = require('../services/bank.service');

const adminBankScene = new Scenes.WizardScene(
    'ADMIN_ADD_BANK_SCENE',
    async (ctx) => {
        await ctx.reply('🏦 *TAMBAH REKENING*\n\nMasukkan Nama Bank/E-Wallet (Contoh: BCA / DANA):', { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if(ctx.message?.text === '/cancel') return ctx.scene.leave();
        ctx.wizard.state.bank_name = ctx.message.text;
        await ctx.reply('Masukkan Nomor Rekening / Nomor E-Wallet:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if(ctx.message?.text === '/cancel') return ctx.scene.leave();
        ctx.wizard.state.account_number = ctx.message.text;
        await ctx.reply('Masukkan Atas Nama:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if(ctx.message?.text === '/cancel') return ctx.scene.leave();
        ctx.wizard.state.account_name = ctx.message.text;
        
        await BankService.addBank(ctx.wizard.state.bank_name, ctx.wizard.state.account_number, ctx.wizard.state.account_name);
        await ctx.reply(`✅ *Rekening Berhasil Ditambahkan!*\n\nBank: ${ctx.wizard.state.bank_name}\nNomor: ${ctx.wizard.state.account_number}\nA/N: ${ctx.wizard.state.account_name}`, { parse_mode: 'Markdown' });
        return ctx.scene.leave();
    }
);
adminBankScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

module.exports = { adminBankScene };
