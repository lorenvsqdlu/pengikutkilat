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
          
          if (!deposit || (deposit.status.toLowerCase() !== 'pending' && deposit.status.toLowerCase() !== 'waiting_approval')) {
              await client.query('ROLLBACK');
              client.release();
              return ctx.reply('❌ Deposit tidak ditemukan atau sudah diproses.');
          }
          
          await client.query(`UPDATE deposits SET status = 'Approved', approved_at = CURRENT_TIMESTAMP, admin_id = $1 WHERE reference_id = $2`, [ctx.from.id, refId]);
          
          const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE', [deposit.user_id]);
          if (userRes.rows.length > 0) {
              const balanceBefore = Math.floor(Number(userRes.rows[0].balance));
              const safeAmount = Math.floor(Number(deposit.amount));
              const balanceAfter = balanceBefore + safeAmount;
              await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [balanceAfter, deposit.user_id]);
              await client.query(`
                  INSERT INTO balance_mutations (user_id, type, amount, balance_before, balance_after, description, reference_id)
                  VALUES ($1, $2, $3, $4, $5, $6, $7)
              `, [deposit.user_id, 'Deposit', safeAmount, balanceBefore, balanceAfter, 'Deposit Approved via Admin', refId]);
          }

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
      [
        Markup.button.callback('⚙️ Ubah Markup %', 'ADMIN_MARKUP'),
        Markup.button.callback('⚠️ Manual Check', 'ADMIN_MANUAL_CHECK')
      ],
      [Markup.button.callback('🏦 Kelola Rekening', 'ADMIN_BANK')],
      [Markup.button.callback('⚙️ Pengaturan Bot', 'ADMIN_BOT_SETTINGS')],
      [
        Markup.button.callback('💰 Cek SMM', 'ADMIN_SMM'),
        Markup.button.callback('📦 Backup DB', 'ADMIN_BACKUP_DB')
      ]
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

     if (action === 'ADMIN_MANUAL_CHECK') return AdminController.handleManualCheckMenu(ctx);
     if (action.startsWith('APPROVE_MANUAL_')) return AdminController.handleApproveManualCheck(ctx, action.replace('APPROVE_MANUAL_', ''));
     if (action.startsWith('RETRY_MANUAL_')) return AdminController.handleRetryManualCheck(ctx, action.replace('RETRY_MANUAL_', ''));
     if (action.startsWith('REFUND_MANUAL_')) return AdminController.handleRefundManualCheck(ctx, action.replace('REFUND_MANUAL_', ''));
     
     if (action === 'ADMIN_BACKUP_DB') return AdminController.handleBackupDb(ctx);

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
         const pendingRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE LOWER(status) IN ('pending', 'waiting_approval')");
         const approvedRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE LOWER(status) = 'approved'");
         const rejectedRows = await db.query("SELECT COUNT(*) as cnt FROM deposits WHERE LOWER(status) = 'rejected'");
         
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
         const hist = await db.query("SELECT * FROM deposits WHERE LOWER(status) IN ('approved', 'rejected') ORDER BY update_at DESC, created_at DESC LIMIT 5");
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
         const logger = require('../utils/logger');
         logger.info(`[DEPOSIT_PENDING_CLICKED] user_id=${ctx.from.id} callback_data=${action}`);
         
         try {
             const pending = await db.query("SELECT * FROM deposits WHERE LOWER(status) IN ('pending', 'waiting_approval') ORDER BY created_at ASC LIMIT 1");
             const deposits = pending[0];
             
             logger.info(`[DEPOSIT_PENDING_FETCH] count=${deposits.length}`);
             
             if (deposits.length === 0) {
                 try {
                     return await ctx.editMessageText('📭 Tidak ada deposit pending saat ini.', {
                         ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
                     });
                 } catch (e) {
                     logger.error(`[DEPOSIT_PENDING_ERROR] edit failed: ${e.message}`);
                     return await ctx.reply('📭 Tidak ada deposit pending saat ini.', {
                         ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
                     });
                 }
             }
             
             const dep = deposits[0];
             const dateFormatted = new Date(dep.created_at).toLocaleString('id-ID');
             const safeAmount = dep.amount || 0;
             
             let txt = `🧾 *Invoice:*\n\`${dep.reference_id || 'UNKNOWN'}\`\n\n👤 *User:*\n${dep.user_id || 'UNKNOWN'}\n\n💰 *Nominal:*\n${formatRupiah(safeAmount)}\n\n📅 *Tanggal:*\n${dateFormatted}\n\n📌 *Status:*\n${dep.status || 'UNKNOWN'}`;
             
             // Validate callback lengths
             const cbApprove = `DEP_APPROVE_${dep.reference_id}`;
             const cbReject = `DEP_REJECT_${dep.reference_id}`;
             
             let inlineKbd = [];
             if (Buffer.byteLength(cbApprove, 'utf8') <= 64 && Buffer.byteLength(cbReject, 'utf8') <= 64) {
                inlineKbd.push([Markup.button.callback('✅ Setujui', cbApprove), Markup.button.callback('❌ Tolak', cbReject)]);
             } else {
                logger.error(`[DEPOSIT_PENDING_ERROR] callback data too long for ref ${dep.reference_id}`);
                txt += `\n\n⚠️ *ID Terlalu Panjang untuk Action*`;
             }
             inlineKbd.push([Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]);
             
             try {
                 await ctx.deleteMessage();
             } catch(e) {}
             
             if (dep.proof_image && !dep.proof_image.startsWith('/upload')) {
                 try {
                    return await ctx.replyWithPhoto(dep.proof_image, {
                        caption: txt,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: inlineKbd
                        }
                    });
                 } catch(e) {
                    logger.error(`[DEPOSIT_PENDING_ERROR] replyWithPhoto failed: ${e.message}`);
                 }
             }
             
             return await ctx.reply(txt, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                      inline_keyboard: inlineKbd
                  }
             });
         } catch (e) {
             logger.error(`[DEPOSIT_PENDING_ERROR] error=${e.message}`);
             try {
                 return await ctx.reply('❌ Terjadi kesalahan sistem saat mengambil data deposit.', {
                     ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_DEPOSIT_MENU')]])
                 });
             } catch (err) {}
         }
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
         const UserService = require('../services/user.service');
         const isLocked = await UserService.isLocked(ctx.from.id);
         if (isLocked) {
             return ctx.answerCbQuery('Mohon tunggu sebentar...', { show_alert: true }).catch(() => {});
         }
         await UserService.setLock(ctx.from.id, 5); // 5s lock
         
         await ctx.answerCbQuery('Memproses...').catch(()=>({}));
         const refId = action.replace('DEP_APPROVE_', '');
         const client = await db.pool.connect();
         try {
             await client.query('BEGIN');
             
             // Use returning for atomic update
             const updateRes = await client.query(`
                UPDATE deposits 
                SET status = 'Approved', approved_at = CURRENT_TIMESTAMP, admin_id = $1 
                WHERE reference_id = $2 AND LOWER(status) IN ('pending', 'waiting_approval')
                RETURNING *
             `, [ctx.from.id, refId]);
             
             if (updateRes.rows.length === 0) {
                 await client.query('ROLLBACK');
                 client.release();
                 const logger = require('../utils/logger');
                 logger.warn(`[DEPOSIT] Approve rejected: ${refId} already processed`);
                 return ctx.reply('❌ Deposit sudah diproses sebelumnya.');
             }
             
             const deposit = updateRes.rows[0];
             
             const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE', [deposit.user_id]);
             if (userRes.rows.length > 0) {
                 const balanceBefore = Math.floor(Number(userRes.rows[0].balance));
                 const safeAmount = Math.floor(Number(deposit.amount));
                 const balanceAfter = balanceBefore + safeAmount;
                 await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [balanceAfter, deposit.user_id]);
                 await client.query(`
                    INSERT INTO balance_mutations (user_id, type, amount, balance_before, balance_after, description, reference_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                 `, [deposit.user_id, 'Deposit', safeAmount, balanceBefore, balanceAfter, 'Deposit Approved via Admin', refId]);
             }
             
             await client.query('COMMIT');
             client.release();
             
             // Logging outside transaction is fine
             const logger = require('../utils/logger');
             logger.info(`[DEPOSIT] approved by admin for ref ${refId}`);
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
             const logger = require('../utils/logger');
             logger.error(`[DEPOSIT] Error approving: ${err.message}\n${err.stack}`);
             return ctx.reply('❌ Terjadi kesalahan saat memproses deposit (Transaksi gagal).');
         }
     }
     
     if (action.startsWith('DEP_REJECT_')) {
         const UserService = require('../services/user.service');
         const isLocked = await UserService.isLocked(ctx.from.id);
         if (isLocked) {
             return ctx.answerCbQuery('Mohon tunggu sebentar...', { show_alert: true }).catch(() => {});
         }
         await UserService.setLock(ctx.from.id, 5); // 5s lock

         await ctx.answerCbQuery('Membuka menu tolakan...').catch(()=>({}));
         const refId = action.replace('DEP_REJECT_', '');
         const deposit = await DepositService.getDepositByRef(refId);
         if (!deposit || (deposit.status.toLowerCase() !== 'pending' && deposit.status.toLowerCase() !== 'waiting_approval')) {
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

  static async handleBackupDb(ctx) {
      if (ctx.callbackQuery) await ctx.editMessageText('⏳ Memulai proses backup PostgreSQL...').catch(()=>{});
      try {
          const fs = require('fs');
          const path = require('path');
          const db = require('../database');
          
          // Simple JSON export for tables
          const tables = ['users', 'deposits', 'orders', 'refunds', 'balance_mutations', 'admin_logs'];
          const backup = {};
          for (const tbl of tables) {
              const [rows] = await db.query(`SELECT * FROM ${tbl}`);
              backup[tbl] = rows;
          }
          
          const filename = `backup_db_${Date.now()}.json`;
          const filePath = path.join(__dirname, '..', '..', filename);
          fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
          
          await ctx.replyWithDocument({ source: filePath, filename });
          fs.unlinkSync(filePath); // delete after sending
          
          if (ctx.callbackQuery) {
              await ctx.editMessageText('✅ Backup berhasil dikirim.').catch(()=>{});
          }
      } catch(e) {
          if (ctx.callbackQuery) {
              await ctx.editMessageText(`❌ Gagal backup DB: ${e.message}`).catch(()=>{});
          }
      }
  }

  static async handleManualCheckMenu(ctx) {
     const db = require('../database');
     const [rows] = await db.query(`SELECT * FROM orders WHERE status = 'MANUAL_CHECK' ORDER BY id ASC LIMIT 5`);
     if (!rows || rows.length === 0) {
         return ctx.editMessageText('✅ Tidak ada order dalam status MANUAL_CHECK.', {
             ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]])
         }).catch(()=>{});
     }
     
     const { formatRupiah } = require('../utils/currency');
     let ordersStr = `⚠️ *ORDER MANUAL CHECK*\n\n`;
     rows.forEach(r => {
        ordersStr += `ID: \`${r.id}\` | User: ${r.user_id}\nLayanan: ${r.service_name}\nHarga: ${formatRupiah(r.price)}\n\n`;
     });
     
     const buttons = rows.map(r => [
        Markup.button.callback(`✅ Selesai (Sukses) ID ${r.id}`, `APPROVE_MANUAL_${r.id}`),
        Markup.button.callback(`💸 Refund ID ${r.id}`, `REFUND_MANUAL_${r.id}`)
     ]);
     buttons.push([Markup.button.callback('🔙 Kembali', 'ADMIN_MENU')]);
     
     return ctx.editMessageText(ordersStr, {
         parse_mode: 'Markdown',
         ...Markup.inlineKeyboard(buttons)
     }).catch(()=>{});
  }
  
  static async handleApproveManualCheck(ctx, id) {
     const db = require('../database');
     await db.query(`UPDATE orders SET status = 'Success' WHERE id = $1 AND status = 'MANUAL_CHECK'`, [id]);
     await ctx.answerCbQuery('✅ Order ditandai Sukses.', { show_alert: true }).catch(()=>{});
     return AdminController.handleManualCheckMenu(ctx);
  }
  
  static async handleRefundManualCheck(ctx, id) {
     const db = require('../database');
     const RefundService = require('../services/refund.service');
     const [rows] = await db.query(`SELECT * FROM orders WHERE id = $1 AND status = 'MANUAL_CHECK'`, [id]);
     if (rows && rows.length > 0) {
         const order = rows[0];
         await db.query(`UPDATE orders SET status = 'Canceled' WHERE id = $1`, [id]);
         await RefundService.processRefund(order.id, order.user_id, order.price, 'Manual Check Refund - Provider Timeout');
         await ctx.answerCbQuery('✅ Saldo direfund ke user.', { show_alert: true }).catch(()=>{});
     }
     return AdminController.handleManualCheckMenu(ctx);
  }
  
  static async handleRetryManualCheck(ctx, id) {
     // Noop or future implementation
  }
}

module.exports = AdminController;
