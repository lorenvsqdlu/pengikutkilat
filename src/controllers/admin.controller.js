const AdminService = require('../services/admin.service');
const smmService = require('../services/smm.service');
const { Markup } = require('telegraf');

const BankService = require('../services/bank.service');
const DepositService = require('../services/deposit.service');
const UserService = require('../services/user.service');
const ProfitEngine = require('../services/profit.engine');
const db = require('../database');

const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

class AdminController {
  
  static async handleProfit(ctx) {
    const parts = ctx.message.text.split(' ');
    const subCommand = parts[1] ? parts[1].toLowerCase() : '';

    try {
      if (subCommand === 'today') {
        const total = await ProfitEngine.getDailyProfit();
        return ctx.reply(`📊 *Profit Hari Ini:*\nRp ${total.toLocaleString('id-ID')}`, { parse_mode: 'Markdown' });
      }

      if (subCommand === 'total') {
        const total = await ProfitEngine.getTotalProfit();
        return ctx.reply(`📈 *Total Profit Keseluruhan:*\nRp ${total.toLocaleString('id-ID')}`, { parse_mode: 'Markdown' });
      }

      if (subCommand === 'category') {
        const categories = await ProfitEngine.getProfitByCategory();
        if (!categories || categories.length === 0) {
            return ctx.reply('Belum ada data profit per kategori.');
        }
        let txt = `📊 *Profit per Kategori:*\n━━━━━━━━━━━━━━━━━\n`;
        for (const cat of categories) {
             const name = cat.category || 'Lainnya';
             txt += `- ${name}: Rp ${parseFloat(cat.total).toLocaleString('id-ID')}\n`;
        }
        return ctx.reply(txt, { parse_mode: 'Markdown' });
      }

      return ctx.reply('⚠️ *Format Salah*\nGunakan perintah:\n/profit today\n/profit total\n/profit category', { parse_mode: 'Markdown' });
    } catch (err) {
      return ctx.reply('❌ Gagal mengambil data profit.');
    }
  }

  static async handleMargin(ctx) {
      const text = ctx.message.text;
      const parts = text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      
      const subCommand = parts[1] ? parts[1].toLowerCase() : '';

      try {
        if (subCommand === 'update') {
           const value = parts[2];
           if (!value || isNaN(value)) return ctx.reply('Format: /margin update <persentase_global>');
           
           await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('markup_percent', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?`, [value, value]);
           return ctx.reply(`✅ Margin global diupdate menjadi ${value}%`);
        }

        if (subCommand === 'set') {
           let catNameRaw = parts[2];
           if (catNameRaw && catNameRaw.startsWith('"') && catNameRaw.endsWith('"')) {
               catNameRaw = catNameRaw.slice(1, -1);
           }
           const value = parts[3];
           const type = parts[4] || 'percent';

           if (!catNameRaw || !value || isNaN(value)) {
               return ctx.reply('Format: /margin set "Nama Kategori" <value> [percent/fixed]\nContoh: /margin set "Instagram Followers" 20 percent');
           }

           const validTypes = ['percent', 'fixed'];
           if(!validTypes.includes(type.toLowerCase())) return ctx.reply('Type harus percent atau fixed');

           await db.query(`
              INSERT INTO category_margins (category_name, margin_type, margin_value) 
              VALUES (?, ?, ?) 
              ON CONFLICT(category_name) DO UPDATE SET margin_type = excluded.margin_type, margin_value = excluded.margin_value
           `, [catNameRaw, type.toLowerCase(), value]);

           return ctx.reply(`✅ Margin untuk kategori "${catNameRaw}" diupdate menjadi ${value} (${type})`);
        }

        return ctx.reply('⚠️ *Format Salah*\nGunakan perintah:\n/margin update <value>\n/margin set "Kategori" <value> [percent/fixed]', { parse_mode: 'Markdown' });
      } catch (err) {
         return ctx.reply(`❌ Gagal mengatur margin: ${err.message}`);
      }
  }

  static async handleAdminMenu(ctx) {
    const menuText = `*MENU ADMIN*\nSilakan pilih menu di bawah ini:`;
    const buttons = [
      [Markup.button.callback('📊 Statistik Web', 'ADMIN_STATS')],
      [Markup.button.callback('📢 Broadcast Notif', 'ADMIN_BROADCAST_MENU')],
      [
        Markup.button.callback('➕ Saldo User', 'ADMIN_BAL_ADD'),
        Markup.button.callback('➖ Saldo User', 'ADMIN_BAL_SUB')
      ],
      [
        Markup.button.callback('🚫 Ban User', 'ADMIN_BAN_ADD'),
        Markup.button.callback('✅ Unban User', 'ADMIN_BAN_SUB')
      ],
      [Markup.button.callback('⚙️ Ubah Markup %', 'ADMIN_MARKUP')],
      [
        Markup.button.callback('🏦 Kelola Rekening', 'ADMIN_BANK'),
        Markup.button.callback('🏷 Kelola QRIS', 'ADMIN_QRIS')
      ],
      [Markup.button.callback('💰 Cek SMM', 'ADMIN_SMM')]
    ];
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(menuText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } else {
      await ctx.reply(menuText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  }

  static async handleCallback(ctx) {
     const action = ctx.match[0];
     await ctx.answerCbQuery();
     
     if (action === 'ADMIN_MENU') return AdminController.handleAdminMenu(ctx);
     
     if (action === 'ADMIN_STATS') {
       const stats = await AdminService.getStats();
       const markup = await AdminService.getSetting('markup_percent') || '20';
       
       const text = `📊 *STATISTIK BOT*\n\n👥 Total User: ${stats.total_users}\n🛒 Total Order: ${stats.total_orders}\n📈 Total Profit: Rp ${parseFloat(stats.total_profit).toLocaleString('id-ID')}\n⚙️ Markup Aktif: ${markup}%`;
       
       await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]])
       });
     }
     
     if (action === 'ADMIN_BROADCAST_MENU') {
        await ctx.editMessageText('Pilih target broadcast:', {
          ...Markup.inlineKeyboard([
             [Markup.button.callback('Semua User (Global)', 'ADMIN_BC_ALL')],
             [Markup.button.callback('User Spesifik', 'ADMIN_BC_USER')],
             [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
          ])
        });
     }
     
     if (action === 'ADMIN_BC_ALL') return ctx.scene.enter('ADMIN_BROADCAST_SCENE', { type: 'all' });
     if (action === 'ADMIN_BC_USER') return ctx.scene.enter('ADMIN_BROADCAST_SCENE', { type: 'user' });
     if (action === 'ADMIN_MARKUP') return ctx.scene.enter('ADMIN_MARKUP_SCENE');
     if (action === 'ADMIN_BAL_ADD') return ctx.scene.enter('ADMIN_BALANCE_SCENE', { type: 'add' });
     if (action === 'ADMIN_BAL_SUB') return ctx.scene.enter('ADMIN_BALANCE_SCENE', { type: 'sub' });
     if (action === 'ADMIN_BAN_ADD') return ctx.scene.enter('ADMIN_BAN_SCENE', { type: 'ban' });
     if (action === 'ADMIN_BAN_SUB') return ctx.scene.enter('ADMIN_BAN_SCENE', { type: 'unban' });
     
     if (action === 'ADMIN_BANK') {
         await ctx.editMessageText('🏦 *KELOLA REKENING*\n\nPilih aksi di bawah ini:', {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('➕ Tambah Rekening', 'ADMIN_ADD_BANK')],
                 [Markup.button.callback('📋 Daftar Rekening Aktif', 'ADMIN_LIST_BANK')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         });
     }
     
     if (action === 'ADMIN_ADD_BANK') return ctx.scene.enter('ADMIN_ADD_BANK_SCENE');
     
     if (action === 'ADMIN_LIST_BANK') {
         const banks = await BankService.getAllBanks();
         if (banks.length === 0) {
             await ctx.editMessageText('Belum ada rekening yang terdaftar.', {
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_BANK')]])
             });
             return;
         }
         let txt = '🏦 *DAFTAR REKENING*\n\n';
         banks.forEach(b => {
            txt += `ID: ${b.id}\nBank: ${b.bank_name}\nNo: ${b.account_number}\nA/N: ${b.account_name}\nStatus: ${b.is_active ? 'Aktif ✅' : 'Nonaktif ❌'}\n\n`;
         });
         await ctx.editMessageText(txt, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_BANK')]])
         });
     }

     if (action === 'ADMIN_QRIS') {
         const QrisService = require('../services/qris.service');
         const qrisList = await QrisService.getActiveQris();
         let txt = `🏷 *Manajemen QRIS*\n\nSaat ini ada ${qrisList.length} QRIS aktif.\n\n_Pilih aksi di bawah ini, atau gunakan Web Admin Hub untuk manajemen lengkap (Edit/Hapus via Web)._`;
         await ctx.editMessageText(txt, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('➕ Tambah QRIS (via Bot)', 'ADMIN_ADD_QRIS')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         });
     }
     
     if (action === 'ADMIN_ADD_QRIS') {
         await ctx.answerCbQuery();
         return ctx.scene.enter('ADMIN_ADD_QRIS_SCENE');
     }

     if (action.startsWith('DEP_APPROVE_')) {
         const refId = action.replace('DEP_APPROVE_', '');
         const deposit = await DepositService.getDepositByRef(refId);
         if (!deposit || deposit.status !== 'Pending') {
             return ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
         }
         const updated = await DepositService.updateDepositStatus(refId, 'Approved', ctx.from.id);
         if (!updated) {
             return ctx.reply('❌ Deposit sudah diproses oleh admin lain.');
         }
         await UserService.updateBalance(deposit.user_id, deposit.amount);
         await AdminService.logAction(ctx.from.id, 'APPROVE_DEPOSIT', { reference_id: refId, amount: deposit.amount });
         
         await ctx.editMessageCaption(`✅ *DEPOSIT APPROVED*\n\nRef: \`${refId}\`\nUser: ${deposit.user_id}\nNominal: *${formatRupiah(deposit.amount)}*\n\n_Diproses oleh @${ctx.from.username || ctx.from.id}_`, {parse_mode: 'Markdown'});
         
         try {
             await ctx.telegram.sendMessage(deposit.user_id, `✅ *DEPOSIT BERHASIL*\n\nNominal: *${formatRupiah(deposit.amount)}*\n\nSaldo otomatis ditambahkan ke akun Anda.`, {parse_mode: 'Markdown'});
         } catch(e){}
     }
     
     if (action.startsWith('DEP_REJECT_')) {
         const refId = action.replace('DEP_REJECT_', '');
         const deposit = await DepositService.getDepositByRef(refId);
         if (!deposit || deposit.status !== 'Pending') {
             return ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
         }
         return ctx.scene.enter('REJECT_DEPOSIT_SCENE', { reference_id: refId });
     }
     if (action === 'ADMIN_SMM') {
         await ctx.editMessageText('⏳ Mengecek SMM...');
         try {
             const res = await smmService.getBalance();
             await ctx.editMessageText(`💰 *SMM Balance Info*\n\nBalance: ${res?.balance || 'Error'}\nCurrency: ${res?.currency || '-'}`, {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]])
             });
         } catch(e) {
             await ctx.editMessageText(`❌ Gagal mengecek SMM: ${e.message}`, {
                  ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]])
             });
         }
     }
  }
}

module.exports = AdminController;
