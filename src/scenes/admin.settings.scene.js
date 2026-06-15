const { Scenes, Markup } = require('telegraf');
const AdminService = require('../services/admin.service');

const adminSetWelcomeScene = new Scenes.WizardScene(
  'ADMIN_SET_WELCOME_SCENE',
  async (ctx) => {
    const isEnabled = await AdminService.getSetting('welcome_enabled') === 'true';
    const message = await AdminService.getSetting('welcome_message') || 'Halo {first_name}';
    
    await ctx.reply(`👋 *PENGATURAN WELCOME MESSAGE*\n\nStatus: ${isEnabled ? '✅ Aktif' : '❌ Nonaktif'}\n\nPesan Saat Ini:\n${message}\n\nPilih aksi di bawah ini:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback(isEnabled ? '❌ Nonaktifkan' : '✅ Aktifkan', 'TOGGLE_WELCOME')],
            [Markup.button.callback('✏️ Ubah Pesan Welcome', 'EDIT_WELCOME')],
            [Markup.button.callback('🔙 Kembali', 'CANCEL_SCENE')]
        ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery().catch(()=>{});
        
        if (action === 'CANCEL_SCENE') {
            await ctx.editMessageText('Batal.');
            return ctx.scene.leave();
        }
        
        if (action === 'TOGGLE_WELCOME') {
            const isEnabled = await AdminService.getSetting('welcome_enabled') === 'true';
            await AdminService.setSetting('welcome_enabled', isEnabled ? 'false' : 'true');
            await ctx.editMessageText(`✅ Welcome message berhasil di${isEnabled ? 'nonaktifkan' : 'aktifkan'}.`);
            return ctx.scene.leave();
        }
        
        if (action === 'EDIT_WELCOME') {
            await ctx.editMessageText('Kirimkan pesan welcome baru.\n\n_Placeholder yang didukung:_\n{first_name}\n{last_name}\n{username}\n{id}\n\nKirimkan teks atau /cancel untuk batal.', {parse_mode: 'Markdown'});
            return ctx.wizard.next();
        }
    } else if (ctx.message?.text === '/cancel') {
        await ctx.reply('Batal.');
        return ctx.scene.leave();
    }
  },
  async (ctx) => {
      if (ctx.message?.text) {
          if (ctx.message.text === '/cancel') {
              await ctx.reply('Batal.');
              return ctx.scene.leave();
          }
          await AdminService.setSetting('welcome_message', ctx.message.text);
          await ctx.reply('✅ Pesan welcome berhasil disimpan!');
          return ctx.scene.leave();
      }
  }
);

adminSetWelcomeScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


const adminForceSubScene = new Scenes.WizardScene(
  'ADMIN_FORCE_SUB_SCENE',
  async (ctx) => {
    const isEnabled = await AdminService.getSetting('force_subscribe_enabled') === 'true';
    const channel = await AdminService.getSetting('force_subscribe_channel') || 'Belum diset';
    
    await ctx.reply(`🔒 *PENGATURAN FORCE SUBSCRIBE*\n\nStatus: ${isEnabled ? '✅ Aktif' : '❌ Nonaktif'}\nChannel: \`${channel}\`\n\nPilih aksi di bawah ini:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback(isEnabled ? '❌ Nonaktifkan' : '✅ Aktifkan', 'TOGGLE_FS')],
            [Markup.button.callback('✏️ Set Username/ID Channel', 'EDIT_FS_CHANNEL')],
            [Markup.button.callback('🔙 Kembali', 'CANCEL_SCENE')]
        ])
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery().catch(()=>{});
        
        if (action === 'CANCEL_SCENE') {
            await ctx.editMessageText('Batal.');
            return ctx.scene.leave();
        }
        
        if (action === 'TOGGLE_FS') {
            const isEnabled = await AdminService.getSetting('force_subscribe_enabled') === 'true';
            await AdminService.setSetting('force_subscribe_enabled', isEnabled ? 'false' : 'true');
            await ctx.editMessageText(`✅ Force subscribe berhasil di${isEnabled ? 'nonaktifkan' : 'aktifkan'}.`);
            return ctx.scene.leave();
        }
        
        if (action === 'EDIT_FS_CHANNEL') {
            await ctx.editMessageText('Kirimkan *Username Channel* (contoh: @nusantarasmm) atau *ID Channel* (pastikan bot menjadi admin di sana).\n\nKirimkan teks atau /cancel untuk batal.', {parse_mode: 'Markdown'});
            return ctx.wizard.next();
        }
    } else if (ctx.message?.text === '/cancel') {
        await ctx.reply('Batal.');
        return ctx.scene.leave();
    }
  },
  async (ctx) => {
      if (ctx.message?.text) {
          if (ctx.message.text === '/cancel') {
              await ctx.reply('Batal.');
              return ctx.scene.leave();
          }
          await AdminService.setSetting('force_subscribe_channel', ctx.message.text.trim());
          await ctx.reply('✅ Channel force subscribe berhasil dikonfigurasi!');
          return ctx.scene.leave();
      }
  }
);

adminForceSubScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


module.exports = {
  adminSetWelcomeScene,
  adminForceSubScene
};
