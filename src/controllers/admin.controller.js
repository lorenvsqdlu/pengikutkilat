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
  
  static async handleApprove(ctx) {
      const parts = ctx.message.text.split(' ');
      const refId = parts[1];
      if (!refId) return ctx.reply('Format: /approve <ref_id>');
      
      const client = await db.pool.connect();
      try {
          await client.query('BEGIN');
          const depositRes = await client.query('SELECT * FROM deposits WHERE reference_id = $1 FOR UPDATE', [refId]);
          const deposit = depositRes.rows[0];
          
          if (!deposit || (deposit.status !== 'Pending' && deposit.status !== 'WAITING_APPROVAL')) {
              await client.query('ROLLBACK');
              client.release();
              return ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
          }
          
          await client.query(`UPDATE deposits SET status = 'Approved', approved_at = CURRENT_TIMESTAMP, admin_id = $1 WHERE reference_id = $2`, [ctx.from.id, refId]);
          await client.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [deposit.amount, deposit.user_id]);
          await client.query('COMMIT');
          client.release();
          
          await AdminService.logAction(ctx.from.id, 'APPROVE_DEPOSIT', { reference_id: refId, amount: deposit.amount });
          
          await ctx.reply(`✅ *DEPOSIT APPROVED*\n\nRef: \`${refId}\`\nUser: ${deposit.user_id}\nNominal: *${formatRupiah(deposit.amount)}*`, {parse_mode: 'Markdown'});
          
          try {
              await ctx.telegram.sendMessage(deposit.user_id, `✅ *Deposit Berhasil*\n\nInvoice: \`${refId}\`\nNominal: *${formatRupiah(deposit.amount)}*\n\nSaldo otomatis ditambahkan ke akun Anda.`, {parse_mode: 'Markdown'});
          } catch(e){}
      } catch (err) {
          await client.query('ROLLBACK');
          client.release();
          return ctx.reply('❌ Gagal memproses: ' + err.message);
      }
  }
  
  static async handleReject(ctx) {
      const parts = ctx.message.text.split(' ');
      const refId = parts[1];
      if (!refId) return ctx.reply('Format: /reject <ref_id>');
      return ctx.scene.enter('REJECT_DEPOSIT_SCENE', { reference_id: refId });
  }

  static async handleAdminMenu(ctx) {
    const menuText = `*MENU ADMIN*\nSilakan pilih menu di bawah ini:`;
    const buttons = [
      [
        Markup.button.callback('💳 Kelola Deposit', 'ADMIN_DEPOSIT_MENU'),
        Markup.button.callback('📊 Statistik Web', 'ADMIN_STATS')
      ],
      [Markup.button.callback('👥 Kelola User', 'ADMIN_USER_MENU')],
      [Markup.button.callback('⚙️ Ubah Markup %', 'ADMIN_MARKUP')],
      [Markup.button.callback('🏦 Kelola Rekening', 'ADMIN_BANK')],
      [Markup.button.callback('⚙️ Pengaturan Bot', 'ADMIN_BOT_SETTINGS')],
      [Markup.button.callback('💰 Cek SMM', 'ADMIN_SMM')]
    ];
    
    if (ctx.callbackQuery) {
      // Use catch to avoid MESSAGE_NOT_MODIFIED error
      await ctx.editMessageText(menuText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(() => {});
    } else {
      await ctx.reply(menuText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  }

  static async handleCallback(ctx) {
     const action = ctx.match[0];
     await ctx.answerCbQuery().catch(() => {});
     
     if (action === 'ADMIN_MENU') return AdminController.handleAdminMenu(ctx);
     
     if (action === 'ADMIN_BOT_SETTINGS') {
         await ctx.editMessageText('⚙️ *PENGATURAN BOT*\n\nPilih aksi di bawah ini:', {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('👋 Set Welcome', 'ADMIN_SET_WELCOME')],
                 [Markup.button.callback('🔒 Force Subscribe', 'ADMIN_FORCE_SUB')],
                 [Markup.button.callback('📢 Broadcast', 'ADMIN_BROADCAST_MENU')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         }).catch(() => {});
     }

     if (action === 'ADMIN_USER_MENU') {
         await ctx.editMessageText('👥 *KELOLA USER*\n\nPilih aksi di bawah ini:\n_Kamu dapat menggunakan Username/Telegram ID pada seluruh fitur ini._', {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('➕ Tambah Saldo', 'ADMIN_BAL_ADD')],
                 [Markup.button.callback('➖ Kurangi Saldo', 'ADMIN_BAL_SUB')],
                 [Markup.button.callback('🚫 Ban User', 'ADMIN_BAN_ADD')],
                 [Markup.button.callback('✅ Unban User', 'ADMIN_BAN_SUB')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         }).catch(() => {});
     }

     if (action === 'ADMIN_DEPOSIT_MENU') {
         const pendingRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE status IN ('Pending', 'WAITING_APPROVAL')");
         const approvedRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE status = 'Approved'");
         const rejectedRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE status = 'Rejected'");
         
         const pendingCount = pendingRows[0][0].cnt;
         const approvedCount = approvedRows[0][0].cnt;
         const rejectedCount = rejectedRows[0][0].cnt;
         
         const text = `💳 *KELOLA DEPOSIT*\n\n📥 Deposit Pending: ${pendingCount}\n✅ Deposit Disetujui: ${approvedCount}\n❌ Deposit Ditolak: ${rejectedCount}`;
         
         return ctx.editMessageText(text, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('📥 Deposit Pending', 'ADMIN_DEPOSIT_PENDING')],
                 [Markup.button.callback('📜 Riwayat Deposit', 'ADMIN_DEPOSIT_HISTORY')],
                 [Markup.button.callback('⚙️ Pengaturan Deposit', 'ADMIN_DEPOSIT_SETTINGS')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         }).catch(() => {});
     }
     
     if (action === 'ADMIN_DEPOSIT_SETTINGS') {
         return ctx.editMessageText('⚙️ *PENGATURAN DEPOSIT*\n\nSilakan pilih yang ingin diubah:', {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('🖼 Ubah QRIS', 'ADMIN_DEP_SET_QRIS')],
                 [Markup.button.callback('🔵 Ubah Nomor DANA', 'ADMIN_DEP_SET_DANA')],
                 [Markup.button.callback('🏦 Ubah Rekening Bank', 'ADMIN_BANK')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]
             ])
         }).catch(() => {});
     }
     
     if (action === 'ADMIN_DEP_SET_DANA') {
         return ctx.scene.enter('ADMIN_DEP_DANA_SCENE');
     }
     
     if (action === 'ADMIN_DEP_SET_QRIS') {
         return ctx.scene.enter('ADMIN_DEP_QRIS_SCENE');
     }
     
     if (action === 'ADMIN_DEPOSIT_HISTORY') {
         const hist = await db.query("SELECT * FROM deposits WHERE status IN ('Approved', 'Rejected') ORDER BY update_at DESC, created_at DESC LIMIT 5");
         const deposits = hist[0];
         if (deposits.length === 0) {
             return ctx.editMessageText('Belum ada riwayat deposit.', {
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
             });
         }
         let txt = `📜 *5 RIWAYAT DEPOSIT TERAKHIR*\n\n`;
         for (const dep of deposits) {
             txt += `Ref: \`${dep.reference_id}\`\nUser: ${dep.user_id}\nNominal: Rp ${dep.amount}\nStatus: *${dep.status}*\n\n`;
         }
         return ctx.editMessageText(txt, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
         });
     }

     if (action === 'ADMIN_DEPOSIT_PENDING') {
         const pending = await db.query("SELECT * FROM deposits WHERE status IN ('Pending', 'WAITING_APPROVAL') ORDER BY created_at ASC LIMIT 1");
         const deposits = pending[0];
         if (deposits.length === 0) {
             return ctx.editMessageText('✅ Tidak ada deposit pending saat ini.', {
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
             });
         }
         
         const dep = deposits[0];
         const dateFormatted = new Date(dep.created_at).toLocaleString('id-ID');
         
         let txt = `🧾 *Invoice:*\n\`${dep.reference_id}\`\n\n👤 *User:*\n${dep.user_id}\n\n💰 *Nominal:*\n${formatRupiah(dep.amount)}\n\n📅 *Tanggal:*\n${dateFormatted}\n\n📌 *Status:*\n${dep.status}`;
         
         try {
             await ctx.deleteMessage();
         } catch(e) {}
         
         const inlineKbd = [
             [Markup.button.callback('✅ Setujui', `DEP_APPROVE_${dep.reference_id}`), Markup.button.callback('❌ Tolak', `DEP_REJECT_${dep.reference_id}`)],
             [Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]
         ];
         
         if (dep.proof_image && !dep.proof_image.startsWith('/upload')) {
             try {
                return await ctx.replyWithPhoto(dep.proof_image, {
                    caption: txt,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inlineKbd
                    }
                });
             } catch(e) {}
         }
         
         return await ctx.reply(txt, {
              parse_mode: 'Markdown',
              reply_markup: {
                  inline_keyboard: inlineKbd
              }
         });
     }
     
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
                 [Markup.button.callback('➕ Tambah Rekening', 'ADMIN_ADD_BANK'), Markup.button.callback('📋 Daftar Rekening', 'ADMIN_LIST_BANK')],
                 [Markup.button.callback('❌ Nonaktifkan Rekening', 'ADMIN_DISABLE_BANK'), Markup.button.callback('✅ Aktifkan Rekening', 'ADMIN_ENABLE_BANK')],
                 [Markup.button.callback('🏷 Kelola QRIS', 'ADMIN_QRIS')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]
             ])
         }).catch(() => {});
     }
     
     if (action === 'ADMIN_ADD_BANK') return ctx.scene.enter('ADMIN_ADD_BANK_SCENE');
     if (action === 'ADMIN_DISABLE_BANK') return ctx.scene.enter('ADMIN_TOGGLE_BANK_SCENE', { type: 'disable' });
     if (action === 'ADMIN_ENABLE_BANK') return ctx.scene.enter('ADMIN_TOGGLE_BANK_SCENE', { type: 'enable' });
     
     if (action === 'ADMIN_LIST_BANK') {
         const banks = await BankService.getAllBanks();
         if (banks.length === 0) {
             await ctx.editMessageText('Belum ada rekening yang terdaftar.', {
                 ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_BANK')]])
             }).catch(() => {});
             return;
         }
         let txt = '🏦 *DAFTAR REKENING*\n\n';
         banks.forEach(b => {
            txt += `ID: ${b.id}\nBank: ${b.bank_name}\nNo: ${b.account_number}\nA/N: ${b.account_name}\nStatus: ${b.is_active ? 'Aktif ✅' : 'Nonaktif ❌'}\n\n`;
         });
         await ctx.editMessageText(txt, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_BANK')]])
         }).catch(() => {});
     }

     if (action === 'ADMIN_QRIS') {
         const QrisService = require('../services/qris.service');
         const qrisList = await QrisService.getActiveQris();
         let txt = `🏷 *Manajemen QRIS*\n\nSaat ini ada ${qrisList.length} QRIS aktif.\n\n_Pilih aksi di bawah ini:_`;
         await ctx.editMessageText(txt, {
             parse_mode: 'Markdown',
             ...Markup.inlineKeyboard([
                 [Markup.button.callback('📤 Upload QRIS', 'ADMIN_ADD_QRIS')],
                 [Markup.button.callback('📋 Lihat QRIS Aktif', 'ADMIN_LIST_QRIS')],
                 [Markup.button.callback('🖼 Ganti QRIS', 'ADMIN_CHANGE_QRIS'), Markup.button.callback('🗑 Hapus QRIS', 'ADMIN_DELETE_QRIS')],
                 [Markup.button.callback('🔙 Kembali', 'ADMIN_BANK')]
             ])
         }).catch(() => {});
     }
     
     if (action === 'ADMIN_LIST_QRIS') {
         const QrisService = require('../services/qris.service');
         const qrisList = await QrisService.getActiveQris();
         if (qrisList.length === 0) {
             return ctx.editMessageText('Belum ada QRIS aktif.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_QRIS')]])}).catch(() => {});
         }
         let txt = '🏷 *DAFTAR QRIS AKTIF*\n\n';
         qrisList.forEach(q => txt += `- ID: ${q.id} | ${q.qris_name}\n`);
         return ctx.editMessageText(txt, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_QRIS')]])}).catch(() => {});
     }
     
     if (action === 'ADMIN_CHANGE_QRIS') {
         // Masuk ke scene upload QRIS
         return ctx.scene.enter('ADMIN_ADD_QRIS_SCENE');
     }
     
     if (action === 'ADMIN_DELETE_QRIS') {
         // Hapus semua QRIS dari database (qris_accounts & settings)
         await db.query("DELETE FROM qris_accounts");
         await db.query("DELETE FROM settings WHERE setting_key = 'deposit_qris_file_id'");
         return ctx.editMessageText('✅ QRIS berhasil dihapus.', {
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_QRIS')]])
         }).catch(() => {});
     }

     if (action === 'ADMIN_ADD_QRIS') {
         await ctx.answerCbQuery().catch(() => {});
         return ctx.scene.enter('ADMIN_ADD_QRIS_SCENE');
     }
     
     if (action === 'ADMIN_SET_WELCOME') return ctx.scene.enter('ADMIN_SET_WELCOME_SCENE');
     if (action === 'ADMIN_FORCE_SUB') return ctx.scene.enter('ADMIN_FORCE_SUB_SCENE');

     if (action.startsWith('DEP_APPROVE_')) {
         const refId = action.replace('DEP_APPROVE_', '');
         
         const client = await db.pool.connect();
         try {
             await client.query('BEGIN');
             
             // Use raw client to ensure transaction lock
             const depositRes = await client.query('SELECT * FROM deposits WHERE reference_id = $1 FOR UPDATE', [refId]);
             const deposit = depositRes.rows[0];
             
             if (!deposit || (deposit.status !== 'Pending' && deposit.status !== 'WAITING_APPROVAL')) {
                 await client.query('ROLLBACK');
                 client.release();
                 return ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
             }
             
             await client.query(`UPDATE deposits SET status = 'Approved', approved_at = CURRENT_TIMESTAMP, admin_id = $1 WHERE reference_id = $2`, [ctx.from.id, refId]);
             await client.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [deposit.amount, deposit.user_id]);
             
             await client.query('COMMIT');
             client.release();
             
             // Logging outside transaction is fine
             await AdminService.logAction(ctx.from.id, 'APPROVE_DEPOSIT', { reference_id: refId, amount: deposit.amount });
             
             try {
                await ctx.editMessageCaption(`✅ *DEPOSIT APPROVED*\n\nRef: \`${refId}\`\nUser: ${deposit.user_id}\nNominal: *${formatRupiah(deposit.amount)}*\n\n_Diproses oleh @${ctx.from.username || ctx.from.id}_`, {parse_mode: 'Markdown'});
             } catch(e) {
                await ctx.editMessageText(`✅ *DEPOSIT APPROVED*\n\nRef: \`${refId}\`\nUser: ${deposit.user_id}\nNominal: *${formatRupiah(deposit.amount)}*\n\n_Diproses oleh @${ctx.from.username || ctx.from.id}_`, {parse_mode: 'Markdown'});
             }
             
             try {
                 await ctx.telegram.sendMessage(deposit.user_id, `✅ *Deposit Berhasil*\n\nInvoice: \`${refId}\`\nNominal: *${formatRupiah(deposit.amount)}*\n\nSaldo telah ditambahkan ke akun Anda.`, {parse_mode: 'Markdown'});
             } catch(e){}

         } catch (err) {
             await client.query('ROLLBACK');
             client.release();
             return ctx.reply('❌ Terjadi kesalahan saat memproses deposit (Transaksi gagal).');
         }
     }
     
     if (action.startsWith('DEP_REJECT_')) {
         const refId = action.replace('DEP_REJECT_', '');
         const deposit = await DepositService.getDepositByRef(refId);
         if (!deposit || (deposit.status !== 'Pending' && deposit.status !== 'WAITING_APPROVAL')) {
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
