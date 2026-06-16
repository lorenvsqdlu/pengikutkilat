const { Scenes, Markup } = require('telegraf');
const smmService = require('../services/smm.service');
const UserService = require('../services/user.service');
const OrderService = require('../services/order.service');
const ProfitEngine = require('../services/profit.engine');
const config = require('../config');
const { sendOrEdit } = require('../utils/ui');

// Helper untuk format Rupiah
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

// Simple in-memory lock for anti double submit
const orderLocks = new Set();

const handleCancel = async (ctx) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await sendOrEdit(ctx, '❌ Order dibatalkan.', {
      ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Home', 'back_to_menu_main')]
      ])
  });
  return ctx.scene.leave();
};

const proceedToConfirm = async (ctx) => {
    const quantity = ctx.wizard.state.order.quantity;
    const service = ctx.wizard.state.order.selectedService;
    
    const basePrice = parseFloat(service.rate || service.price);
    const categoryName = service.category || '';

    const calculated = await ProfitEngine.calculatePrice(basePrice, quantity, categoryName);
    
    const totalPrice = calculated.sell_price;
    const totalProfit = calculated.profit;
    const costPrice = calculated.cost_price;
    
    ctx.wizard.state.order.totalPrice = totalPrice;
    ctx.wizard.state.order.profit = totalProfit;
    ctx.wizard.state.order.costPrice = costPrice;
    ctx.wizard.state.order.category = categoryName;

    const confirmText = `
📄 *KONFIRMASI ORDER*
━━━━━━━━━━━━━━━━━
*Layanan:* ${service.name}
*Kategori:* ${categoryName}
*Target:* ${ctx.wizard.state.order.target}
*Jumlah:* ${quantity}
*Total Harga:* ${formatRupiah(totalPrice)}
━━━━━━━━━━━━━━━━━
Apakah data di atas sudah benar?
    `;

    await ctx.reply(confirmText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Pesan Sekarang', 'CONFIRM_ORDER')],
        [Markup.button.callback('❌ Batal', 'CANCEL')]
      ])
    });

    ctx.wizard.selectStep(6);
};

const orderScene = new Scenes.WizardScene(
  'ORDER_SCENE',
  // Step 1: Menu Utama -> Pilih Kategori Platform (Instagram, TikTok, dll)
  async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.order = {};
    
    if (!smmService.servicesCache) {
      // Tunggu cache diisi oleh worker yang berjalan di background
      await sendOrEdit(ctx, '⏳ Sedang memuat layanan SMM, silakan coba beberapa saat lagi.');
      return ctx.scene.leave();
    }

    const groupedServices = smmService.getGroupedServices();
    if (groupedServices.length === 0) {
      await sendOrEdit(ctx, '❌ Tidak ada layanan yang tersedia saat ini.');
      return ctx.scene.leave();
    }

    const buttons = [];
    let row = [];
    
    let hasLainnya = false;
    groupedServices.forEach(g => {
        if (g.platform === 'Lainnya') {
            hasLainnya = g.services.length > 0;
            return;
        }
        if (g.services.length > 0) {
            row.push(Markup.button.callback(g.platform, `PLATFORM_${g.platform}`));
            if (row.length === 2) {
                buttons.push(row);
                row = [];
            }
        }
    });
    
    if (row.length > 0) {
       buttons.push(row);
    }
    if (hasLainnya) {
       buttons.push([Markup.button.callback('Lainnya', 'PLATFORM_Lainnya')]);
    }
    buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);
    
    await sendOrEdit(ctx, '🛍️ *Pilih Platform*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    return ctx.wizard.next();
  },
  
  // Step 2: Pilih Kategori Layanan (Followers, Likes, Views dll)
  async (ctx) => {
    try {
      if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
      if (!ctx.callbackQuery) return;
      
      const action = ctx.callbackQuery.data;
      if (action === 'CANCEL') return handleCancel(ctx);
      
      if (action.startsWith('PLATFORM_')) {
        await ctx.answerCbQuery().catch(() => {});
        const platformName = action.replace('PLATFORM_', '');
        ctx.wizard.state.order.platform = platformName;
        
        const logger = require('../utils/logger');
        logger.info(`[PLATFORM CLICK] User ${ctx.from.id} chose platform ${platformName}`);
        
        const groupedServices = smmService.getGroupedServices();
        let platformData = groupedServices.find(g => g.platform === platformName);
        
        // Fallback normalizer
        if (!platformData) {
            const normReq = platformName.toLowerCase().replace(/[^a-z]/g, '');
            platformData = groupedServices.find(g => g.platform.toLowerCase().replace(/[^a-z]/g, '') === normReq);
        }
        
        if (!platformData || platformData.services.length === 0) {
            await sendOrEdit(ctx, '❌ Layanan untuk platform ini tidak tersedia.');
            return ctx.scene.leave();
        }

        // Ambil unik kategori pada platform tersebut
        const categoriesSet = new Set();
        platformData.services.forEach(s => categoriesSet.add(s.category));
        const categories = Array.from(categoriesSet).slice(0, 15); // Ambil maks 15 kategori supaya tidak terlalu penuh

        const buttons = [];
        let catIndex = 0;
        
        let hasCatLainnya = false;
        categories.forEach(cat => {
            const safeCat = cat || 'Lainnya';
            if (safeCat === 'Lainnya') { 
                hasCatLainnya = true; 
                return; 
            }
            const callbackData = `CAT_${catIndex++}`;
            if (!ctx.wizard.state.catMap) ctx.wizard.state.catMap = {};
            ctx.wizard.state.catMap[callbackData] = safeCat;
            buttons.push([Markup.button.callback(safeCat.substring(0, 40), callbackData)]);
        });
        
        if (hasCatLainnya) {
            const callbackData = `CAT_${catIndex++}`;
            if (!ctx.wizard.state.catMap) ctx.wizard.state.catMap = {};
            ctx.wizard.state.catMap[callbackData] = 'Lainnya';
            buttons.push([Markup.button.callback('Lainnya', callbackData)]);
        }

        buttons.push([Markup.button.callback('🔙 Kembali', 'BACK_TO_PLATS')]);
        buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

        await sendOrEdit(ctx, `Pilih Kategori ${platformName}:`, {
          ...Markup.inlineKeyboard(buttons)
        });
        return ctx.wizard.next();
      }
      
      // Unhandled callbacks (e.g. from previous steps) must be answered to avoid frozen button
      await ctx.answerCbQuery().catch(() => {});
    } catch (err) {
      const logger = require('../utils/logger');
      logger.error(`[CALLBACK ERROR] Step 2 failed:`, err.message);
      await sendOrEdit(ctx, '❌ Terjadi kesalahan saat memuat layanan. Silakan coba kembali beberapa saat lagi.').catch(() => {});
      return ctx.scene.leave();
    }
  },

  // Step 3: Pilih Layanan Spesifik
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    if (action === 'BACK_TO_PLATS') {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.scene.reenter();
    }
    
    if (action.startsWith('CAT_')) {
        await ctx.answerCbQuery().catch(() => {});
        const selectedCategory = ctx.wizard.state.catMap[action];
        if (!selectedCategory) {
            await sendOrEdit(ctx, 'Kategori tidak valid atau sesi kadaluwarsa.');
            return ctx.scene.leave();
        }

        ctx.wizard.state.order.category = selectedCategory;
        
        const logger = require('../utils/logger');
        logger.info(`[CATEGORY CLICK] User ${ctx.from.id} chose category ${selectedCategory}`);
        
        await sendOrEdit(ctx, '⏳ Mengambil daftar layanan...');
        
        try {
            const groupedServices = smmService.getGroupedServices();
            if (!groupedServices || groupedServices.length === 0) {
                 logger.warn(`[CACHE MISS] No cached services found during order flow.`);
                 throw new Error('Cache layanan kosong. Silakan coba lagi.');
            }
            
            let platformData = groupedServices.find(g => g.platform === ctx.wizard.state.order.platform);
            
            if (!platformData) {
                const normReq = ctx.wizard.state.order.platform.toLowerCase().replace(/[^a-z]/g, '');
                platformData = groupedServices.find(g => g.platform.toLowerCase().replace(/[^a-z]/g, '') === normReq);
            }
            
            if (!platformData) throw new Error('Data platform tidak ditemukan');

            const filteredServices = platformData.services
                .filter(s => s.category === selectedCategory)
                .slice(0, 10); // Max 10 layanan agar inline keyboard tidak error
            
            if (filteredServices.length === 0) {
                await sendOrEdit(ctx, 'Maaf, layanan tidak tersedia saat ini.');
                return ctx.scene.leave();
            }

            ctx.wizard.state.availableServices = filteredServices;
            const ProfitEngine = require('../services/profit.engine');
            
            const buttons = await Promise.all(filteredServices.map(async s => {
                const basePrice = parseFloat(s.price || s.rate || 0);
                const p = await ProfitEngine.calculatePrice(basePrice, 1000, s.category);
                const safeName = s.name || `Service ${s.service}`;
                return [Markup.button.callback(`${safeName.substring(0, 40)} | ${formatRupiah(p.sell_price)}/K`, `SERVICE_${s.service}`)];
            }));
            
            buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

            await sendOrEdit(ctx, `Layanan dalam ${selectedCategory}:`, {
                ...Markup.inlineKeyboard(buttons)
            });
            return ctx.wizard.next();

        } catch (error) {
            const logger = require('../utils/logger');
            logger.error(`[CALLBACK ERROR] Step 3 category failed:`, error.message);
            await sendOrEdit(ctx, 'Terjadi kesalahan saat mengambil layanan SMM. Silakan coba menu lagi (Cache kosong/Timeout).');
            return ctx.scene.leave();
        }
    }
    
    // Fallback for unmatched action
    await ctx.answerCbQuery().catch(() => {});
  },

  // Step 4: Masukkan Target (Username / Link)
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    
    if (action.startsWith('SERVICE_')) {
      await ctx.answerCbQuery().catch(() => {});
      const serviceId = action.replace('SERVICE_', '');
      const selectedService = ctx.wizard.state.availableServices.find(s => s.service == serviceId);
      
      if (!selectedService) {
        await sendOrEdit(ctx, 'Layanan tidak valid atau sesi order expired. Silakan mulai ulang.');
        return ctx.scene.leave();
      }
      
      const logger = require('../utils/logger');
      logger.info(`[SERVICE CLICK] User ${ctx.from.id} chose service ${serviceId}`);
      
      ctx.wizard.state.order.selectedService = selectedService;
      
      const typeDesc = selectedService.type !== 'default' ? `\n(Tipe: ${selectedService.type})` : '';
      
      let promptText = `Layanan terpilih: *${selectedService.name || serviceId}*${typeDesc}\nMin: ${selectedService.min} | Max: ${selectedService.max}\n\nMasukkan target (Link/Username):`;
      
      try {
        await sendOrEdit(ctx, promptText, {
          parse_mode: 'Markdown'
        });
        return ctx.wizard.next();
      } catch (err) {
        logger.error(`[CALLBACK ERROR] Step 4 prompt generation failed:`, err.message);
        return ctx.scene.leave();
      }
    }
    
    // Fallback
    await ctx.answerCbQuery().catch(() => {});
  },

  // Step 5: Masukkan Target & Data Khusus
  async (ctx) => {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        return;
    }
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.message || !ctx.message.text) return;

    const sType = ctx.wizard.state.order.selectedService.type;
    
    // Simpan target
    if (!ctx.wizard.state.order.customDataCollected) {
         const target = ctx.message.text;
         
         // Validasi target universal
         const isValidTarget = (
            target.includes("instagram.com") ||
            target.includes("tiktok.com") ||
            target.includes("youtube.com") ||
            target.includes("facebook.com") ||
            target.includes("twitter.com") ||
            target.includes("x.com") ||
            target.includes("shopee") ||
            target.includes("tokopedia") ||
            /^[a-zA-Z0-9._@:/-]+$/.test(target)
         );
         
         if (!isValidTarget) {
             await ctx.reply('Target tidak valid. Masukkan URL atau format username yang valid.');
             return;
         }

         ctx.wizard.state.order.target = target;
         
         // Jika ada input extra yang dibutuhkan berdasarkan type
         if (['custom_comment', 'mention_list'].includes(sType)) {
             ctx.wizard.state.order.customDataCollected = true;
             await ctx.reply(`Masukkan ${sType === 'custom_comment' ? 'komentar' : 'usernames'} (Pisahkan dengan baris baru/Enter):`);
             return; // Tetap di step ini
         } else if (['mention_hashtag', 'mention_follower', 'mention_media', 'poll', 'comment_reply'].includes(sType)) {
             ctx.wizard.state.order.customDataCollected = 'extra_field_1';
             if (sType === 'mention_hashtag') await ctx.reply('Masukkan hashtag tanpa #:');
             if (sType === 'mention_follower' || sType === 'comment_reply') await ctx.reply('Masukkan username target tambahan:');
             if (sType === 'mention_media') await ctx.reply('Masukkan link media/post tambahan:');
             if (sType === 'poll') await ctx.reply('Masukkan pilihan jawaban (angka, misal: 2):');
             return;
         } else if (sType === 'comment_likes') {
             ctx.wizard.state.order.customDataCollected = 'username_field';
             await ctx.reply('Masukkan username pemilik komentar (comment_likes):');
             return;
         }
    } else {
         // Menyimpan extra data
         const text = ctx.message.text;
         if (ctx.wizard.state.order.customDataCollected === true) {
             if (sType === 'custom_comment') ctx.wizard.state.order.comments = text;
             if (sType === 'mention_list') ctx.wizard.state.order.usernames = text;
             // Menghitung quantity berdasarkan baris jika tipe ini
             ctx.wizard.state.order.quantity = text.split('\n').filter(Boolean).length;
             
             // Karena tipe ini otomatis quantity-nya, langsung lompat ke konfirmasi (Skip step jumlah)
             return proceedToConfirm(ctx);
         } else if (ctx.wizard.state.order.customDataCollected === 'extra_field_1') {
             if (sType === 'mention_hashtag') ctx.wizard.state.order.hashtag = text;
             if (sType === 'mention_follower' || sType === 'comment_reply') ctx.wizard.state.order.username = text;
             if (sType === 'mention_media') ctx.wizard.state.order.media = text;
             if (sType === 'poll') ctx.wizard.state.order.answer_number = parseInt(text) || 1;
             
             if (sType === 'comment_reply') {
                 ctx.wizard.state.order.customDataCollected = 'comments_field';
                 await ctx.reply('Masukkan komentar (Pisahkan baris baru untuk multi):');
                 return;
             }
         } else if (ctx.wizard.state.order.customDataCollected === 'username_field') {
             ctx.wizard.state.order.username = text;
         } else if (ctx.wizard.state.order.customDataCollected === 'comments_field') {
             ctx.wizard.state.order.comments = text;
             ctx.wizard.state.order.quantity = text.split('\n').filter(Boolean).length;
             return proceedToConfirm(ctx);
         }
    }
    
    if (sType === 'package' || sType === 'package' || ctx.wizard.state.order.selectedService.category === 'package') {
       // Tipe package biasanya tidak minta jumlah, jumlah = max atau min
       ctx.wizard.state.order.quantity = ctx.wizard.state.order.selectedService.min || 1;
       return proceedToConfirm(ctx);
    }
    
    await ctx.reply(`Masukkan jumlah order (Min: ${ctx.wizard.state.order.selectedService.min}, Max: ${ctx.wizard.state.order.selectedService.max}):`);
    return ctx.wizard.next();
  },

  // Step 6: Masukkan Jumlah
  async (ctx) => {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
        return;
    }
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.message || !ctx.message.text) return;

    const quantity = parseInt(ctx.message.text);
    const service = ctx.wizard.state.order.selectedService;
    
    if (isNaN(quantity) || quantity < parseInt(service.min) || quantity > parseInt(service.max)) {
      await ctx.reply(`Jumlah tidak valid! Harus antara ${service.min} dan ${service.max}. Silakan masukkan jumlah yang benar atau /cancel.`);
      return; // Tetap di step ini
    }

    ctx.wizard.state.order.quantity = quantity;
    return proceedToConfirm(ctx);
  },

  // Step 6: Eksekusi Order
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);

    if (action === 'CONFIRM_ORDER') {
      const userId = ctx.from.id;
      
      if (orderLocks.has(userId)) {
          await ctx.answerCbQuery('Order Anda sebelumnya masih ditambahkan, mohon tunggu...', { show_alert: true }).catch(() => {});
          return;
      }
      
      await ctx.answerCbQuery().catch(() => {});
      orderLocks.add(userId);
      
      try {
          // Check DB lock
          const isLocked = await UserService.isLocked(userId);
          if (isLocked) {
              return ctx.reply('⚠️ Anda mengirim order terlalu cepat. Pesanan sebelumnya masih diproses. Mohon tunggu.');
          }
          await UserService.setLock(userId, 10); // lock 10s

          const orderState = ctx.wizard.state.order;
          const user = await UserService.getUser(userId);

          if (!user) {
            await ctx.reply('User tidak ditemukan. Ketik /start');
            return ctx.scene.leave();
          }

          // RE-VALIDATE SERVICE AND PRICE
          const services = smmService.getServices();
          const latestService = services.find(s => s.service == orderState.selectedService.service);
          
          if (!latestService) {
              await ctx.reply('❌ Layanan ini sudah tidak tersedia di provider atau sedang dinonaktifkan.');
              return ctx.scene.leave();
          }

          const basePrice = parseFloat(latestService.rate || latestService.price);
          const categoryName = latestService.category || '';
          const calculated = await ProfitEngine.calculatePrice(basePrice, orderState.quantity, categoryName);
          
          if (calculated.sell_price !== orderState.totalPrice) {
              await ctx.reply(`❌ Order dibatalkan. Terdapat perubahan harga pada layanan ini dari server (sebelumnya ${formatRupiah(orderState.totalPrice)}, sekarang ${formatRupiah(calculated.sell_price)}). Silakan ulangi pesanan.`);
              return ctx.scene.leave();
          }
          
          orderState.totalPrice = calculated.sell_price;
          orderState.costPrice = calculated.cost_price;
          orderState.profit = calculated.profit;

          const currentBalance = parseFloat(user.balance || 0);
          if (currentBalance < orderState.totalPrice) {
            await ctx.reply(`❌ Saldo tidak mencukupi untuk melakukan order ini.\nSaldo saat ini: ${formatRupiah(currentBalance)}`);
            return ctx.scene.leave();
          }

          // Create pending order without deduct balance yet
          const orderId = await OrderService.createOrder({
            user_id: user.telegram_id,
            service_id: orderState.selectedService.service,
            service_name: orderState.selectedService.name || `Service ${orderState.selectedService.service}`,
            api_order_id: null,
            target: orderState.target,
            quantity: orderState.quantity,
            price: orderState.totalPrice, // back compat
            cost_price: 0,
            sell_price: orderState.totalPrice,
            profit: 0,
            category: orderState.category,
            status: 'Pending'
          });

          let smmPayload = {
              service: orderState.selectedService.service || orderState.selectedService.id,
              target: orderState.target,
              quantity: orderState.quantity
          };
          if (orderState.comments) smmPayload.comments = orderState.comments;
          if (orderState.usernames) smmPayload.usernames = orderState.usernames;
          if (orderState.hashtag) smmPayload.hashtag = orderState.hashtag;
          if (orderState.username) smmPayload.username = orderState.username;
          if (orderState.media) smmPayload.media = orderState.media;
          if (orderState.answer_number) smmPayload.answer_number = orderState.answer_number;
          
          // Anti Duplicate SMM Order
          smmPayload.custom_id = orderId.toString();

          const QueueService = require('../services/queue.service');
          await QueueService.pushOrder({
                 order_id: orderId,
                 user_id: userId,
                 price: orderState.totalPrice,
                 base_price: parseFloat(orderState.selectedService.rate || orderState.selectedService.price || 0),
                 quantity: orderState.quantity,
                 category: orderState.category,
                 smm_payload: smmPayload
          });

          const processingMessage = await ctx.reply(`⏳ *Pesanan Sedang Diproses*\n\nID Order: \`${orderId}\`\nPesanan Anda telah masuk dalam antrean sistem untuk diproses server penyedia. \nSaldo Anda dikurangi setelah order sukses pada sistem provider.\nSistem akan memberi notifikasi otomatis.`, { parse_mode: 'Markdown' });
          return ctx.scene.leave();
      } catch (error) {
          const logger = require('../utils/logger');
          logger.error('Error saat submit order queue:', error);
          await ctx.reply(`❌ Terjadi kesalahan sistem saat memproses antrean order: ${error.message}.`);
          return ctx.scene.leave();
      } finally {
          orderLocks.delete(userId);
      }
    }
    
    // Fallback
    await ctx.answerCbQuery().catch(() => {});
  }
);

orderScene.command('cancel', handleCancel);

module.exports = orderScene;
