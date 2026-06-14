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
  // Step 1: Menu Utama -> Pilih Kategori Platform (Instagram)
  async (ctx) => {
    ctx.wizard.state.order = {};
    
    await ctx.reply('🛍️ *Menu Order*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📸 Instagram', 'PLATFORM_INSTAGRAM')],
        [Markup.button.callback('❌ Batal', 'CANCEL')]
      ])
    });
    return ctx.wizard.next();
  },
  
  // Step 2: Pilih Tipe Layanan (Followers)
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);
    
    if (action === 'PLATFORM_INSTAGRAM') {
      await ctx.answerCbQuery();
      ctx.wizard.state.order.platform = 'Instagram';
      
      await ctx.reply('Pilih Tipe Layanan:', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👥 Followers', 'TYPE_FOLLOWERS')],
          [Markup.button.callback('❤️ Likes', 'TYPE_LIKES')],
          [Markup.button.callback('❌ Batal', 'CANCEL')]
        ])
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
    
    ctx.wizard.state.order.type = action === 'TYPE_FOLLOWERS' ? 'Followers' : 'Likes';
    await ctx.answerCbQuery();
    
    const loadingMessage = await ctx.reply('⏳ Mengambil daftar layanan dari server...');
    
    try {
      // Use cached services to avoid hitting SMM API directly from bot routes
      if (!smmService.servicesCache) {
         await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
         await ctx.reply('Layanan sedang disinkronisasi, silakan coba beberapa saat lagi.');
         return ctx.scene.leave();
      }

      const servicesData = smmService.servicesCache.raw;
      let services = [];

      if (servicesData.status === true && Array.isArray(servicesData.services)) {
        services = servicesData.services;
      } else if (Array.isArray(servicesData)) {
        services = servicesData;
      } else if (servicesData.data && Array.isArray(servicesData.data)) {
        services = servicesData.data;
      }
      
      // Filter berdasarkan kategori
      // Catatan: Nama kategori bisa bervariasi tergantung panel, 
      // kita gunakan regex case insensitive untuk mencari 'instagram' dan 'follower'/'like'
      const platformRegex = new RegExp(ctx.wizard.state.order.platform, 'i');
      const typeRegex = new RegExp(ctx.wizard.state.order.type.replace('s', ''), 'i');
      
      const filteredServices = services.filter(s => {
         const cat = (s.category || '').toLowerCase();
         const name = (s.name || '').toLowerCase();
         // Cocokkan kategori / nama dengan kata kunci
         return (platformRegex.test(cat) || platformRegex.test(name)) && 
                (typeRegex.test(cat) || typeRegex.test(name));
      }).slice(0, 5); // Ambil 5 teratas saja agar Telegram tidak error tombol kepanjangan
      
      if (filteredServices.length === 0) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
        await ctx.reply('Maaf, layanan tidak tersedia saat ini. Silakan coba lagi nanti.');
        return ctx.scene.leave();
      }

      ctx.wizard.state.availableServices = filteredServices;
      const ProfitEngine = require('../services/profit.engine');
      
      const buttons = await Promise.all(filteredServices.map(async s => {
        const basePrice = parseFloat(s.rate || s.price);
        const p = await ProfitEngine.calculatePrice(basePrice, 1000, s.category);
        return [Markup.button.callback(`${s.name.substring(0, 40)} | ${formatRupiah(p.sell_price)}/K`, `SERVICE_${s.service}`)];
      }));
      
      buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
      await ctx.reply('Pilih layanan yang diinginkan (Menampilkan max 5):', {
        ...Markup.inlineKeyboard(buttons)
      });
      return ctx.wizard.next();

    } catch (error) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
      await ctx.reply('Terjadi kesalahan saat mengambil layanan SMM.');
      return ctx.scene.leave();
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
         ctx.wizard.state.order.target = ctx.message.text;
         
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
