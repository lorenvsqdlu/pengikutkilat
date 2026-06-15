const { Scenes, Markup } = require('telegraf');

const searchServicesScene = new Scenes.WizardScene(
  'SEARCH_SERVICES_SCENE',
  async (ctx) => {
    await ctx.reply('🔍 Masukkan kata kunci layanan yang ingin dicari (contoh: tiktok views, instagram followers):\n(Ketik /cancel untuk membatalkan)', {
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'cancel_search')]])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(()=>{});
        if (ctx.callbackQuery.data === 'cancel_search') {
            await ctx.editMessageText('Batal.');
            return ctx.scene.leave();
        }
        return;
    }
    if (ctx.message?.text === '/cancel') {
        await ctx.reply('Pencarian dibatalkan.');
        return ctx.scene.leave();
    }
    if (!ctx.message || !ctx.message.text) return;
    
    ctx.session.searchKeyword = ctx.message.text.trim();
    // Redirect to services with page 1
    const UserController = require('../controllers/user.controller');
    ctx.match = [null, '1']; // simulate match for page 1
    await UserController.handleServices(ctx, true);
    return ctx.scene.leave();
  }
);
searchServicesScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

module.exports = searchServicesScene;
