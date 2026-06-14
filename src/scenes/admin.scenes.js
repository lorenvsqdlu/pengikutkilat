const { Scenes, Markup } = require('telegraf');
const UserService = require('../services/user.service');
const AdminService = require('../services/admin.service');

const adminBroadcastScene = new Scenes.WizardScene(
  'ADMIN_BROADCAST_SCENE',
  async (ctx) => {
    const type = ctx.scene.state.type;
    ctx.wizard.state.type = type;
    await ctx.reply(`Kirimkan pesan yang ingin di-broadcast ke ${type === 'all' ? 'SEMUA USER' : 'USER SPESIFIK'}:\n(Gunakan text biasa atau /cancel untuk batal)`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel') {
        await ctx.reply('Broadcast dibatalkan.');
        return ctx.scene.leave();
    }
    
    const message = ctx.message?.text || ctx.message?.caption;
    if (!message) return ctx.reply('Mohon kirimkan pesan teks / caption.');
    
    const targetType = ctx.wizard.state.type;
    
    if (targetType === 'user') {
      ctx.wizard.state.message = message;
      await ctx.reply('Kirimkan Telegram ID User tujuan:');
      return ctx.wizard.next();
    } else {
      ctx.wizard.state.message = message;
      await ctx.reply(`Pesan Broadcast Anda:\n\n${message}\n\n✅ Akan dikirim ke SEMUA user. Yakin?`, Markup.inlineKeyboard([
        Markup.button.callback('✅ Ya, Kirim', 'CONFIRM'),
        Markup.button.callback('❌ Batal', 'CANCEL')
      ]));
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    const targetType = ctx.wizard.state.type;
    
    if (targetType === 'all') {
       if (!ctx.callbackQuery) return;
       await ctx.answerCbQuery().catch(() => {});
       if (ctx.callbackQuery.data === 'CANCEL') {
           await ctx.editMessageText('Broadcast dibatalkan.');
           return ctx.scene.leave();
       }
       if (ctx.callbackQuery.data === 'CONFIRM') {
           await ctx.editMessageText('⏳ Mengirim broadcast ke seluruh user...');
           const users = await UserService.getAllUsers();
           let success = 0; let failed = 0;
           for (const u of users) {
             try {
                await ctx.telegram.sendMessage(u.telegram_id, ctx.wizard.state.message);
                success++;
             } catch(e) { failed++; }
           }
           await AdminService.logAction(ctx.from.id, 'BROADCAST_ALL', { success, failed });
           await ctx.reply(`✅ Broadcast selesai.\nSukses: ${success}\nGagal: ${failed}`);
           return ctx.scene.leave();
       }
    } else { // user target
       if (ctx.message?.text) {
           if (ctx.message.text === '/cancel') return ctx.scene.leave();
           const userId = ctx.message.text.trim();
           try {
             await ctx.telegram.sendMessage(userId, ctx.wizard.state.message);
             await AdminService.logAction(ctx.from.id, 'BROADCAST_USER', { target: userId, status: 'success' });
             await ctx.reply(`✅ Pesan berhasil dikirim ke ${userId}.`);
           } catch(e) {
             await AdminService.logAction(ctx.from.id, 'BROADCAST_USER', { target: userId, status: 'failed', error: e.message });
             await ctx.reply(`❌ Gagal mengirim: ${e.message}`);
           }
           return ctx.scene.leave();
       }
    }
  }
);
adminBroadcastScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

const adminMarkupScene = new Scenes.WizardScene('ADMIN_MARKUP_SCENE',
  async (ctx) => {
    await ctx.reply('Persentase markup saat ini. Mengambil dari DB...\nMasukkan nilai Markup baru dalam bentuk persentase (contoh: 25):\nKetik /cancel untuk batal.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel' || !ctx.message) return ctx.scene.leave();
    const val = parseFloat(ctx.message.text);
    if (isNaN(val) || val < 0) {
      await ctx.reply('Harus berupa angka posifit! Coba lagi.');
      return;
    }
    
    await AdminService.setSetting('markup_percent', val.toString());
    await AdminService.logAction(ctx.from.id, 'UPDATE_MARKUP', { new_value: val });
    
    await ctx.reply(`✅ Markup persentase SMM berhasil diubah menjadi ${val}%`);
    return ctx.scene.leave();
  }
);
adminMarkupScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

const adminBalanceScene = new Scenes.WizardScene('ADMIN_BALANCE_SCENE',
  async (ctx) => {
    const type = ctx.scene.state.type;
    ctx.wizard.state.action = type;
    await ctx.reply(`Kirimkan Telegram ID User yang ingin di${type === 'add' ? 'TAMBAH' : 'KURANGI'} saldonya:\n(Ketik /cancel untuk batal)`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel' || !ctx.message) return ctx.scene.leave();
    ctx.wizard.state.targetUserId = ctx.message.text.trim();
    
    await ctx.reply('Masukkan jumlah nominal saldo (tanpa titik/koma):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel' || !ctx.message) return ctx.scene.leave();
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Gagal, saldo tidak valid. Coba lagi.');
      return;
    }
    
    const isAdd = ctx.wizard.state.action === 'add';
    const delta = isAdd ? amount : -amount;
    
    try {
      const dbResult = await UserService.updateBalance(ctx.wizard.state.targetUserId, delta);
      if (dbResult.affectedRows === 0) {
        await ctx.reply('❌ User tidak ditemukan dalam sistem.');
        return ctx.scene.leave();
      }
      await AdminService.logAction(ctx.from.id, isAdd ? 'ADD_BALANCE' : 'SUB_BALANCE', { target: ctx.wizard.state.targetUserId, amount });
      await ctx.reply(`✅ Saldo user ${ctx.wizard.state.targetUserId} berhasil di${isAdd ? 'TAMBAH' : 'KURANGI'} sebesar Rp ${amount}.`);
    } catch(e) {
      await ctx.reply(`❌ Gagal: ${e.message}`);
    }
    return ctx.scene.leave();
  }
);
adminBalanceScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });

const adminBanScene = new Scenes.WizardScene('ADMIN_BAN_SCENE',
  async (ctx) => {
    const type = ctx.scene.state.type;
    ctx.wizard.state.action = type;
    await ctx.reply(`Kirimkan Telegram ID User yang ingin di${type === 'ban' ? 'BANNED' : 'UNBAN'}:\n(Ketik /cancel untuk batal)`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '/cancel' || !ctx.message) return ctx.scene.leave();
    const tgId = ctx.message.text.trim();
    const isBan = ctx.wizard.state.action === 'ban';
    
    try {
      const success = await UserService.setBanStatus(tgId, isBan);
      if (success) {
        await AdminService.logAction(ctx.from.id, isBan ? 'BAN_USER' : 'UNBAN_USER', { target: tgId });
        await ctx.reply(`✅ Status kelayakan user ${tgId} berhasil diubah (Banned: ${isBan}).`);
      } else {
         await ctx.reply('❌ User tidak ditemukan.');
      }
    } catch(e) {
      await ctx.reply(`❌ Gagal: ${e.message}`);
    }
    return ctx.scene.leave();
  }
);
adminBanScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


module.exports = {
  adminBroadcastScene,
  adminMarkupScene,
  adminBalanceScene,
  adminBanScene
};
