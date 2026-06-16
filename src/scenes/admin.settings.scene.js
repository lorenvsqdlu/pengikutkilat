const { Scenes, Markup } = require('telegraf');
const AdminService = require('../services/admin.service');

const renderCancel = () => Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'CANCEL_SCENE')]]);

const escapeHtml = (unsafe) => {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
};

const adminSetWelcomeScene = new Scenes.WizardScene(
  'ADMIN_SET_WELCOME_SCENE',
  async (ctx) => {
    try {
        const isEnabled = await AdminService.getSetting('welcome_enabled') === 'true';
        const message = await AdminService.getSetting('welcome_message') || 'Halo {first_name}';
        
        const renderData = [`👋 <b>PENGATURAN WELCOME MESSAGE</b>\n\nStatus: ${isEnabled ? '✅ Aktif' : '❌ Nonaktif'}\n\nPesan Saat Ini:\n${escapeHtml(message)}\n\nPilih aksi di bawah ini:`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback(isEnabled ? '❌ Nonaktifkan' : '✅ Aktifkan', 'TOGGLE_WELCOME')],
                [Markup.button.callback('✏️ Ubah Pesan Welcome', 'EDIT_WELCOME')],
                [Markup.button.callback('🔙 Kembali', 'CANCEL_SCENE')] // Changed to back
            ])
        }];
        
        if (ctx.callbackQuery) {
            await ctx.editMessageText(...renderData).catch(() => ctx.reply(...renderData));
        } else {
            await ctx.reply(...renderData);
        }
        return ctx.wizard.next();
    } catch (e) {
        ctx.scene.leave();
        ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
    }
  },
  async (ctx) => {
    try {
        if (ctx.callbackQuery) {
            const action = ctx.callbackQuery.data;
            await ctx.answerCbQuery().catch(()=>{});
            
            // Allow other action to break the scene (prevent Scene lock)
            if (['ADMIN_MENU', 'ADMIN_BROADCAST_MENU', 'ADMIN_FORCE_SUB', 'ADMIN_SET_WELCOME'].includes(action)) {
                await ctx.scene.leave();
                // Pass it to next middleware or just let it drop? Let's leave scene and ignore, the user will have to click again.
                return;
            }

            if (action === 'CANCEL_SCENE') {
                await ctx.editMessageText('Batal. Silakan klik menu admin kembali.');
                const AdminController = require('../controllers/admin.controller');
                await AdminController.handleAdminMenu(ctx).catch(()=>{});
                return ctx.scene.leave();
            }
            
            if (action === 'TOGGLE_WELCOME') {
                const isEnabled = await AdminService.getSetting('welcome_enabled') === 'true';
                await AdminService.setSetting('welcome_enabled', isEnabled ? 'false' : 'true');
                await ctx.answerCbQuery('✅ Berhasil diperbarui.').catch(() => {});
                return ctx.scene.reenter();
            }
            
            if (action === 'EDIT_WELCOME') {
                await ctx.editMessageText('<b>Kirimkan pesan welcome baru.</b>\n\n<i>Placeholder yang didukung:</i>\n{first_name}\n{last_name}\n{username}\n{id}\n\nKirimkan teks atau klik Batal.', {
                    parse_mode: 'HTML',
                    ...renderCancel()
                });
                return ctx.wizard.next();
            }
        } else if (ctx.message?.text === '/cancel' || ctx.message?.text === '/admin' || ctx.message?.text === '/start') {
            await ctx.scene.leave();
            return;
        }
    } catch (e) {
        ctx.scene.leave();
        ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
    }
  },
  async (ctx) => {
      try {
          if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL_SCENE') {
              await ctx.answerCbQuery().catch(()=>{});
              await ctx.editMessageText('Batal.').catch(()=>{});
              return ctx.scene.leave();
          }

          if (ctx.message?.text) {
              if (ctx.message.text === '/cancel' || ctx.message.text === '/admin' || ctx.message.text === '/start') {
                  const txt = ctx.message.text;
                  await ctx.scene.leave();
                  // Re-evaluate command if it's start or admin
                  return;
              }
              const txt = ctx.message.text;
              if (txt.length > 2000) {
                  await ctx.reply('❌ Pesan welcome terlalu panjang (maksimal 2000 karakter).\nSilakan kirim ulang:', renderCancel());
                  return;
              }

              // Simple test to see if telegram allows the escaped HTML. The text goes into setting raw, then gets escaped when displayed.
              
              await AdminService.setSetting('welcome_message', txt);
              await ctx.reply('✅ Pesan welcome berhasil disimpan!');
              return ctx.scene.reenter();
          }
      } catch (e) {
          ctx.scene.leave();
          ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
      }
  }
);

adminSetWelcomeScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


const adminForceSubScene = new Scenes.WizardScene(
  'ADMIN_FORCE_SUB_SCENE',
  async (ctx) => {
    try {
        const isEnabled = await AdminService.getSetting('force_subscribe_enabled') === 'true';
        const channel = await AdminService.getSetting('force_subscribe_channel') || 'Belum diset';
        
        const renderData = [`🔒 <b>PENGATURAN FORCE SUBSCRIBE</b>\n\nStatus: ${isEnabled ? '✅ Aktif' : '❌ Nonaktif'}\nChannel: <code>${escapeHtml(channel)}</code>\n\nPilih aksi di bawah ini:`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback(isEnabled ? '❌ Nonaktifkan' : '✅ Aktifkan', 'TOGGLE_FS')],
                [Markup.button.callback('✏️ Set Username/ID Channel', 'EDIT_FS_CHANNEL')],
                [Markup.button.callback('🔙 Kembali', 'CANCEL_SCENE')]
            ])
        }];
        
        if (ctx.callbackQuery) {
            await ctx.editMessageText(...renderData).catch(() => ctx.reply(...renderData));
        } else {
            await ctx.reply(...renderData);
        }
        return ctx.wizard.next();
    } catch (e) {
        ctx.scene.leave();
        ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
    }
  },
  async (ctx) => {
    try {
        if (ctx.callbackQuery) {
            const action = ctx.callbackQuery.data;
            await ctx.answerCbQuery().catch(()=>{});
            
            // Allow other action to break the scene
            if (['ADMIN_MENU', 'ADMIN_BROADCAST_MENU', 'ADMIN_FORCE_SUB', 'ADMIN_SET_WELCOME'].includes(action)) {
                await ctx.scene.leave();
                return;
            }

            if (action === 'CANCEL_SCENE') {
                await ctx.editMessageText('Batal. Silakan klik menu admin kembali.');
                const AdminController = require('../controllers/admin.controller');
                await AdminController.handleAdminMenu(ctx).catch(()=>{});
                return ctx.scene.leave();
            }
            
            if (action === 'TOGGLE_FS') {
                const isEnabled = await AdminService.getSetting('force_subscribe_enabled') === 'true';
                await AdminService.setSetting('force_subscribe_enabled', isEnabled ? 'false' : 'true');
                await ctx.answerCbQuery('✅ Berhasil diperbarui.').catch(() => {});
                return ctx.scene.reenter();
            }
            
            if (action === 'EDIT_FS_CHANNEL') {
                await ctx.editMessageText('<b>Kirimkan Username Channel (contoh: @nusantarasmm) atau ID Channel</b>\n(pastikan bot menjadi admin di channel tersebut).\n\nKirimkan teks atau klik Batal.', {
                    parse_mode: 'HTML',
                    ...renderCancel()
                });
                return ctx.wizard.next();
            }
        } else if (ctx.message?.text === '/cancel' || ctx.message?.text === '/admin' || ctx.message?.text === '/start') {
            await ctx.scene.leave();
            return;
        }
    } catch (e) {
        ctx.scene.leave();
        ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
    }
  },
  async (ctx) => {
      try {
          if (ctx.callbackQuery && ctx.callbackQuery.data === 'CANCEL_SCENE') {
              await ctx.answerCbQuery().catch(()=>{});
              await ctx.editMessageText('Batal.').catch(()=>{});
              return ctx.scene.leave();
          }

          if (ctx.message?.text) {
              if (ctx.message.text === '/cancel' || ctx.message.text === '/admin' || ctx.message.text === '/start') {
                  await ctx.scene.leave();
                  return;
              }

              const txt = ctx.message.text.trim();
              
              if (!txt.startsWith('@') && !txt.startsWith('-100')) {
                  await ctx.reply('❌ Username channel tidak valid.\nContoh yang benar:\n@ChannelSaya\n\nSilakan kirim ulang:', renderCancel());
                  return;
              }

              await AdminService.setSetting('force_subscribe_channel', txt);
              await ctx.reply('✅ Channel force subscribe berhasil dikonfigurasi!');
              return ctx.scene.reenter();
          }
      } catch (e) {
          ctx.scene.leave();
          ctx.reply('Terjadi kesalahan, silakan buka menu admin kembali.').catch(()=>{});
      }
  }
);

adminForceSubScene.command('cancel', (ctx) => { ctx.reply('Batal.'); ctx.scene.leave(); });


module.exports = {
  adminSetWelcomeScene,
  adminForceSubScene
};
