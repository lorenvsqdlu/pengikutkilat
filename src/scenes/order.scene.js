const { Scenes, Markup } = require('telegraf');
const smmService = require('../services/smm.service');
const UserService = require('../services/user.service');
const OrderService = require('../services/order.service');
const ProfitEngine = require('../services/profit.engine');
const config = require('../config');

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
  await ctx.reply('❌ Order dibatalkan.', Markup.removeKeyboard());
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
    ctx.wizard.state.order = {};
    
    if (!smmService.servicesCache) {
      // Tunggu cache diisi oleh worker yang berjalan di background
      await ctx.reply('⏳ Sedang memuat layanan SMM, silakan coba beberapa saat lagi.');
      return ctx.scene.leave();
    }

    const groupedServices = smmService.getGroupedServices();
    if (groupedServices.length === 0) {
      await ctx.reply('❌ Tidak ada layanan yang tersedia saat ini.');
      return ctx.scene.leave();
    }

    const buttons = [];
    let row = [];
    
    groupedServices.forEach(g => {
        if (g.services.length > 0) {
            row.push(Markup.button.callback(g.platform, `PLATFORM_${g.platform}`));
            if (row.length === 2) {
                buttons.push(row);
                row = [];
            }
        }
    });
    if (row.length > 0) buttons.push(row);
    buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);
    
    await ctx.reply('🛍️ *Pilih Platform*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    return ctx.wizard.next();
  },
  
  // Step 2: Pilih Kategori Layanan (Followers, Likes, Views dll)
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    
    if (action.startsWith('PLATFORM_')) {
      await ctx.answerCbQuery();
      const platformName = action.replace('PLATFORM_', '');
      ctx.wizard.state.order.platform = platformName;
      
      const groupedServices = smmService.getGroupedServices();
      const platformData = groupedServices.find(g => g.platform === platformName);
      
      if (!platformData || platformData.services.length === 0) {
          await ctx.reply('Layanan untuk platform ini tidak tersedia.');
          return ctx.scene.leave();
      }

      // Ambil unik kategori pada platform tersebut
      const categoriesSet = new Set();
      platformData.services.forEach(s => categoriesSet.add(s.category));
      const categories = Array.from(categoriesSet).slice(0, 15); // Ambil maks 15 kategori supaya tidak terlalu penuh

      const buttons = [];
      let catIndex = 0;
      categories.forEach(cat => {
          // Bikin callback data yang unik tapi tidak over 64 bytes
          const callbackData = `CAT_${catIndex++}`;
          
          // Simpan map di context
          if (!ctx.wizard.state.catMap) ctx.wizard.state.catMap = {};
          ctx.wizard.state.catMap[callbackData] = cat;

          buttons.push([Markup.button.callback(cat.substring(0, 40), callbackData)]);
      });
      buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

      await ctx.reply(`Pilih Kategori ${platformName}:`, {
        ...Markup.inlineKeyboard(buttons)
      });
      return ctx.wizard.next();
    }
  },

  // Step 3: Pilih Layanan Spesifik
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    
    if (action.startsWith('CAT_')) {
        await ctx.answerCbQuery();
        const selectedCategory = ctx.wizard.state.catMap[action];
        if (!selectedCategory) {
            await ctx.reply('Kategori tidak valid atau sesi kadaluwarsa.');
            return ctx.scene.leave();
        }

        ctx.wizard.state.order.category = selectedCategory;
        
        const loadingMessage = await ctx.reply('⏳ Mengambil daftar layanan...');
        
        try {
            const groupedServices = smmService.getGroupedServices();
            const platformData = groupedServices.find(g => g.platform === ctx.wizard.state.order.platform);
            
            if (!platformData) throw new Error('Data platform tidak ditemukan');

            const filteredServices = platformData.services
                .filter(s => s.category === selectedCategory)
                .slice(0, 10); // Max 10 layanan agar inline keyboard tidak error
            
            if (filteredServices.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
                await ctx.reply('Maaf, layanan tidak tersedia saat ini.');
                return ctx.scene.leave();
            }

            ctx.wizard.state.availableServices = filteredServices;
            const ProfitEngine = require('../services/profit.engine');
            
            const buttons = await Promise.all(filteredServices.map(async s => {
                const basePrice = parseFloat(s.price || s.rate);
                const p = await ProfitEngine.calculatePrice(basePrice, 1000, s.category);
                return [Markup.button.callback(`${s.name.substring(0, 40)} | ${formatRupiah(p.sell_price)}/K`, `SERVICE_${s.service}`)];
            }));
            
            buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
            await ctx.reply(`Layanan dalam ${selectedCategory}:`, {
                ...Markup.inlineKeyboard(buttons)
            });
            return ctx.wizard.next();

        } catch (error) {
            if (loadingMessage) await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
            await ctx.reply('Terjadi kesalahan saat mengambil layanan SMM.');
            return ctx.scene.leave();
        }
    }
  },

  // Step 4: Masukkan Target (Username / Link)
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    
    if (action.startsWith('SERVICE_')) {
      await ctx.answerCbQuery();
      const serviceId = action.replace('SERVICE_', '');
      const selectedService = ctx.wizard.state.availableServices.find(s => s.service == serviceId);
      
      if (!selectedService) {
        await ctx.reply('Layanan tidak valid.');
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.order.selectedService = selectedService;
      
      const typeDesc = selectedService.type !== 'default' ? `\n(Tipe: ${selectedService.type})` : '';
      
      let promptText = `Layanan terpilih: *${selectedService.name}*${typeDesc}\nMin: ${selectedService.min} | Max: ${selectedService.max}\n\nMasukkan target (Link/Username):`;
      
      await ctx.reply(promptText, {
        parse_mode: 'Markdown'
      });
      return ctx.wizard.next();
    }
  },

  // Step 5: Masukkan Target & Data Khusus
  async (ctx) => {
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
          await ctx.answerCbQuery('Order Anda sebelumnya masih ditambahkan, mohon tunggu...', { show_alert: true });
          return;
      }
      
      await ctx.answerCbQuery();
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

          if (parseFloat(user.balance) < orderState.totalPrice) {
            await ctx.reply(`❌ Saldo tidak mencukupi untuk melakukan order ini.\nSaldo saat ini: ${formatRupiah(user.balance)}`);
            return ctx.scene.leave();
          }

          // Create pending order without deduct balance yet
          const orderId = await OrderService.createOrder({
            user_id: user.telegram_id,
            service_id: orderState.selectedService.service,
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

          const { orderQueue } = require('../queue');
          
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

          orderQueue.push({
             type: 'order',
             payload: {
                 order_id: orderId,
                 user_id: userId,
                 price: orderState.totalPrice,
                 base_price: parseFloat(orderState.selectedService.rate || orderState.selectedService.price),
                 quantity: orderState.quantity,
                 category: orderState.category,
                 smm_payload: smmPayload
             }
          });

          const processingMessage = await ctx.reply(`⏳ *Pesanan Sedang Diproses*\n\nID Order: \`${orderId}\`\nPesanan Anda telah masuk dalam antrean sistem untuk diproses server penyedia. \nSaldo Anda dikurangi setelah order sukses pada sistem provider.\nSistem akan memberi notifikasi otomatis.`, { parse_mode: 'Markdown' });
          return ctx.scene.leave();
      } catch (error) {
          logger.error('Error saat submit order queue:', error);
          await ctx.reply(`❌ Terjadi kesalahan sistem saat memproses antrean order: ${error.message}.`);
          return ctx.scene.leave();
      } finally {
          orderLocks.delete(userId);
      }
    }
  }
);

orderScene.command('cancel', handleCancel);

module.exports = orderScene;
