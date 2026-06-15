const UserService = require('../services/user.service');
const logger = require('../utils/logger');
const { sendOrEdit } = require('../utils/ui');
const { Markup } = require('telegraf');

class UserController {
  static async handleOrderHistory(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const user = await UserService.getUser(ctx.from.id);
      if (!user) return sendOrEdit(ctx, 'Pendaftaran belum selesai. Ketik /start');

      const page = ctx.match && ctx.match[1] ? parseInt(ctx.match[1]) : 1;
      const limit = 5;
      const offset = (page - 1) * limit;

      const db = require('../database');
      const [orders] = await db.query(`SELECT id, created_at, status, service_name FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`, [user.telegram_id, limit, offset]);
      
      const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM orders WHERE user_id = ?`, [user.telegram_id]);
      
      if (orders.length === 0) {
        return sendOrEdit(ctx, 'Belum ada riwayat pesanan.', { 
           ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]])
        });
      }

      const buttons = [];
      orders.forEach(o => {
          const dateStr = new Date(o.created_at).toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric'});
          const shortName = o.service_name ? o.service_name.substring(0, 15) + '..' : 'Layanan';
          buttons.push([Markup.button.callback(`[${o.status}] #${o.id} - ${shortName}`, `order_detail_${o.id}`)]);
      });

      const navButtons = [];
      if (page > 1) navButtons.push(Markup.button.callback('⬅️ Prev', `menu_order_history_${page - 1}`));
      if ((offset + limit) < total) navButtons.push(Markup.button.callback('Next ➡️', `menu_order_history_${page + 1}`));
      if (navButtons.length > 0) buttons.push(navButtons);

      buttons.push([Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]);

      await sendOrEdit(ctx, `🛒 *Riwayat Pesanan (Halaman ${page})*\nPilih pesanan untuk melihat detail:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e) {
      logger.error('handleOrderHistory error:', e);
      await sendOrEdit(ctx, 'Gagal memuat riwayat pesanan.');
    }
  }

  static async handleOrderDetail(ctx) {
     try {
       if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
       const orderId = ctx.match && ctx.match[1];
       if (!orderId) return;

       const db = require('../database');
       const [rows] = await db.query(`SELECT id, created_at, service_name, target, quantity, sell_price, start_count, remains, status, api_order_id FROM orders WHERE id = ?`, [orderId]);
       const order = rows[0];
       if (!order) return sendOrEdit(ctx, 'Pesanan tidak ditemukan.');

       const d = new Date(order.created_at);
       const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
       const dateStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
       
       const sName = order.service_name ? order.service_name.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Layanan SMM';

       const text = `<b>Detail Pesanan #${order.id}</b>\n\n<b>ID Pesanan:</b>\n#${order.id}\n<b>Dibuat:</b>\n${dateStr}\n<b>Layanan:</b>\n${sName}\n<b>Target:</b>\n${order.target}\n<b>Jumlah Pesan:</b>\n${order.quantity}\n<b>Biaya:</b>\nRp ${order.sell_price}\n<b>Jumlah Awal:</b>\n${order.start_count || 0}\n<b>Sisa:</b>\n${order.remains || 0}\n<b>Status:</b>\n${order.status}`;

       await sendOrEdit(ctx, text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
             [Markup.button.callback('🔄 Refresh Pesanan', `refresh_order_${order.id}`)],
             [Markup.button.callback('🔙 Kembali', 'menu_order_history_1')]
          ])
       });
     } catch (e) {
       logger.error('handleOrderDetail error:', e);
     }
  }

  static async handleRefreshOrder(ctx) {
     try {
       const orderId = ctx.match && ctx.match[1];
       if (!orderId) return;

       const db = require('../database');
       const [rows] = await db.query(`SELECT id, created_at, service_name, target, quantity, sell_price, start_count, remains, status, api_order_id FROM orders WHERE id = ?`, [orderId]);
       const order = rows[0];

       if (!order) {
           return ctx.answerCbQuery('Pesanan tidak ditemukan.', { show_alert: true }).catch(() => {});
       }

       if (!order.api_order_id && order.status === 'Pending') {
           return ctx.answerCbQuery('Status masih Pending (belum diteruskan ke provider).', { show_alert: true }).catch(() => {});
       }

       if (order.api_order_id && !['Completed', 'Canceled', 'Cancelled', 'Partial'].includes(order.status)) {
           const smmService = require('../services/smm.service');
           try {
               const res = await smmService.getOrderStatus(order.api_order_id);
               if (res) {
                   let apiData = res[order.api_order_id.toString()] || res;
                   if (apiData.status || apiData.order_status) {
                       let rawStatus = apiData.status || apiData.order_status;
                       const finalStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
                       
                       const sc = apiData.start_count !== undefined && !isNaN(parseInt(apiData.start_count)) ? parseInt(apiData.start_count) : order.start_count;
                       const rem = apiData.remains !== undefined && !isNaN(parseInt(apiData.remains)) ? parseInt(apiData.remains) : order.remains;
                       
                       order.status = finalStatus;
                       order.start_count = sc || 0;
                       order.remains = rem || 0;

                       await db.query(`UPDATE orders SET status = ?, start_count = ?, remains = ? WHERE id = ?`, [finalStatus, order.start_count, order.remains, order.id]);
                   }
               }
           } catch(apiError) {
               return ctx.answerCbQuery(`API Gagal: ${apiError.message}`, { show_alert: true }).catch(() => {});
           }
       }

       const d = new Date(order.created_at);
       const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
       const dateStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
       
       const sName = order.service_name ? order.service_name.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Layanan SMM';

       const text = `<b>Detail Pesanan #${order.id}</b>\n\n<b>ID Pesanan:</b>\n#${order.id}\n<b>Dibuat:</b>\n${dateStr}\n<b>Layanan:</b>\n${sName}\n<b>Target:</b>\n${order.target}\n<b>Jumlah Pesan:</b>\n${order.quantity}\n<b>Biaya:</b>\nRp ${order.sell_price}\n<b>Jumlah Awal:</b>\n${order.start_count || 0}\n<b>Sisa:</b>\n${order.remains || 0}\n<b>Status:</b>\n${order.status}`;

       await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
             [Markup.button.callback('🔄 Refresh Pesanan', `refresh_order_${order.id}`)],
             [Markup.button.callback('🔙 Kembali', 'menu_order_history_1')]
          ])
       });
       await ctx.answerCbQuery('Pesanan berhasil di-refresh!').catch(() => {});
     } catch (e) {
       if (e.description && e.description.includes('message is not modified')) {
           return ctx.answerCbQuery('Belum ada perubahan status dari API provider.', { show_alert: true }).catch(() => {});
       }
       logger.error('handleRefreshOrder error:', e);
       await ctx.answerCbQuery('Gagal refresh, coba lagi nanti.', { show_alert: true }).catch(() => {});
     }
  }

  static async handleProfile(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return await sendOrEdit(ctx, 'Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      const profileText = `
👤 *PROFIL PENGGUNA*
━━━━━━━━━━━━━━━━━━━━
*ID:* \`${user.telegram_id}\`
*Username:* ${user.username ? '@' + user.username : 'Tidak diset'}
*Nama:* ${user.fullname}
*Terdaftar:* ${new Date(user.created_at).toLocaleString('id-ID')}
      `;
      
      await sendOrEdit(ctx, profileText.trim(), { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
        ])
      });
    } catch (error) {
      logger.error('Error in UserController.handleProfile', error);
      await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat profil Anda.');
    }
  }

  static async handleSaldo(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      const user = await UserService.getUser(ctx.from.id);
      
      if (!user) {
        return await sendOrEdit(ctx, 'Data pengguna tidak ditemukan. Silakan kirim perintah /start terlebih dahulu untuk mendaftar.');
      }
      
      // Mengubah angka saldo jadi format Rupiah
      const balanceStr = new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR',
        minimumFractionDigits: 0
      }).format(user.balance);
      
      const saldoText = `💰 *INFO SALDO*\nSaat ini saldo Anda adalah: *${balanceStr}*`;
      
      await sendOrEdit(ctx, saldoText, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
        ])
      });
    } catch (error) {
      logger.error('Error in UserController.handleSaldo', error);
      await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat saldo Anda.');
    }
  }

  static async handleServices(ctx) {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      // Allow searching by parsing args if from text command
      let keyword = '';
      if (ctx.message && ctx.message.text) {
          keyword = ctx.message.text.split(' ').slice(1).join(' ');
      }
      
      const smmService = require('../services/smm.service');
      const AdminService = require('../services/admin.service');
      const config = require('../config');
      
      const queryStr = keyword.trim();
      let grouped = [];
      
      if (queryStr) {
          grouped = smmService.searchServices(queryStr);
      } else {
          grouped = smmService.getGroupedServices();
      }
      
      const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu_main')]
      ]);

      if (!grouped || grouped.length === 0) {
         return await sendOrEdit(ctx, queryStr ? `Pencarian "${queryStr}" tidak menemukan layanan apapun.` : 'Daftar layanan sedang kosong atau belum tersedia.', { ...keyboard });
      }
      
      const ProfitEngine = require('../services/profit.engine');
      const formatRupiah = (angka) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
      };
      
      let resText = `📋 *DAFTAR LAYANAN*\n${queryStr ? `Pencarian: ${queryStr}\n` : ''}━━━━━━━━━━━━━━━━\n`;
      
      // Limit to max 10 categories if no search to avoid too long message
      const displayGroups = queryStr ? grouped : grouped.slice(0, 10);
      
      for (const group of displayGroups) {
          let catText = `\n📂 *${group.category}*\n`;
          let limitItems = queryStr ? group.services : group.services.slice(0, 5);
          for (const s of limitItems) {
              const basePrice = parseFloat(s.price);
              const calculated = await ProfitEngine.calculatePrice(basePrice, 1000, group.category);
              const sellPrice = calculated.sell_price;
              catText += ` ↳ ID: \`${s.service || s.id}\` | ${s.name}\n     💰 ${formatRupiah(sellPrice)} | 📊 Min: ${s.min} Max: ${s.max} | ⚙️ Tipe: ${s.type}\n`;
          }
          if (!queryStr && group.services.length > 5) {
               catText += `   ... _dan ${group.services.length - 5} lainnya (Gunakan pencarian)_ \n`;
          }
          
          if (resText.length + catText.length > 3500) {
              resText += `\n_...Pesan terlalu panjang, silakan gunakan pencarian._`;
              break;
          }
          resText += catText;
      }
      
      if (!queryStr) {
          resText += `\n💡 Tip: Coba cari dengan \`/services instagram\` atau \`/services follower\``;
      }
      
      await sendOrEdit(ctx, resText, { parse_mode: 'Markdown', ...keyboard });
      
    } catch (error) {
       logger.error('Error in handleServices', error);
       await sendOrEdit(ctx, 'Terjadi kesalahan saat memuat daftar layanan.');
    }
  }
}

module.exports = UserController;
