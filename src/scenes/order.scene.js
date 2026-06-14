const { Scenes, Markup } = require('telegraf');
const smmService = require('../services/smm.service');
const UserService = require('../services/user.service');
const OrderService = require('../services/order.service');
const config = require('../config');

// Helper untuk format Rupiah
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka);
};

const handleCancel = async (ctx) => {
  await ctx.reply('❌ Order dibatalkan.', Markup.removeKeyboard());
  return ctx.scene.leave();
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
      const servicesData = await smmService.getServices();
      let services = [];
      
      const AdminService = require('../services/admin.service');
      const markupStr = await AdminService.getSetting('markup_percent');
      const MARKUP_PERCENT = parseFloat(markupStr) || config.MARKUP_PERCENT || 20;

      if (Array.isArray(servicesData)) {
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
      ctx.wizard.state.order.markupSettings = MARKUP_PERCENT;
      
      const buttons = filteredServices.map(s => {
        // Hitung harga setelah markup
        const basePrice = parseFloat(s.rate || s.price);
        const sellPrice = basePrice + (basePrice * (MARKUP_PERCENT / 100));
        
        return [Markup.button.callback(`${s.name.substring(0, 40)} | ${formatRupiah(sellPrice)}/K`, `SERVICE_${s.service}`)];
      });
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
      
      await ctx.reply(`Layanan terpilih: *${selectedService.name}*\nMin: ${selectedService.min} | Max: ${selectedService.max}\n\nMasukkan target (Link/Username):`, {
        parse_mode: 'Markdown'
      });
      return ctx.wizard.next();
    }
  },

  // Step 5: Masukkan Jumlah
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.message || !ctx.message.text) return;

    ctx.wizard.state.order.target = ctx.message.text;
    
    await ctx.reply(`Masukkan jumlah order (Min: ${ctx.wizard.state.order.selectedService.min}, Max: ${ctx.wizard.state.order.selectedService.max}):`);
    return ctx.wizard.next();
  },

  // Step 6: Konfirmasi Order
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
    
    const MARKUP_PERCENT = ctx.wizard.state.order.markupSettings || 20;
    const basePrice = parseFloat(service.rate || service.price);
    
    const targetProfitPer1000 = (basePrice * (MARKUP_PERCENT / 100));
    const totalProfit = (targetProfitPer1000 / 1000) * quantity;
    
    const sellPricePer1000 = basePrice + targetProfitPer1000;
    const totalPrice = (sellPricePer1000 / 1000) * quantity;
    
    ctx.wizard.state.order.totalPrice = totalPrice;
    ctx.wizard.state.order.profit = totalProfit;

    const confirmText = `
📄 *KONFIRMASI ORDER*
━━━━━━━━━━━━━━━━━
*Layanan:* ${service.name}
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

    return ctx.wizard.next();
  },

  // Step 7: Eksekusi Order
  async (ctx) => {
    if (ctx.message && ctx.message.text === '/cancel') return handleCancel(ctx);
    if (!ctx.callbackQuery) return;
    
    const action = ctx.callbackQuery.data;
    if (action === 'CANCEL') return handleCancel(ctx);

    if (action === 'CONFIRM_ORDER') {
      await ctx.answerCbQuery();
      const orderState = ctx.wizard.state.order;
      const user = await UserService.getUser(ctx.from.id);

      if (!user) {
        await ctx.reply('User tidak ditemukan. Ketik /start');
        return ctx.scene.leave();
      }

      if (parseFloat(user.balance) < orderState.totalPrice) {
        await ctx.reply(`❌ Saldo tidak mencukupi untuk melakukan order ini.\nSaldo saat ini: ${formatRupiah(user.balance)}`);
        return ctx.scene.leave();
      }

      const processingMessage = await ctx.reply('⏳ Sedang memproses order ke API...');

      try {
        // Potong saldo di awal untuk mencegah race condition (double spend)
        await UserService.updateBalance(ctx.from.id, -orderState.totalPrice);
      } catch (balanceError) {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
        await ctx.reply(`❌ Saldo tidak mencukupi untuk melakukan order ini atau terjadi kesalahan system.\nSaldo Error: ${balanceError.message}`);
        return ctx.scene.leave();
      }

      try {
        // Kirim ke SMM
        const smmResponse = await smmService.createOrder(
          orderState.selectedService.service,
          orderState.target,
          orderState.quantity
        );

        if (smmResponse && (smmResponse.order || smmResponse.status === 'success')) {
          // Simpan order di DB
          const apiOrderId = smmResponse.order || smmResponse.id || 'N/A';
          await OrderService.createOrder({
            user_id: user.telegram_id,
            service_id: orderState.selectedService.service,
            api_order_id: apiOrderId.toString(),
            target: orderState.target,
            quantity: orderState.quantity,
            price: orderState.totalPrice,
            profit: orderState.profit,
            status: 'Pending'
          });

          await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
          await ctx.reply(`✅ *Order Berhasil Dibuat!*\n\nID Order API: \`${apiOrderId}\`\nLayanan: ${orderState.selectedService.name}\nTarget: ${orderState.target}\nJumlah: ${orderState.quantity}\nHarga: ${formatRupiah(orderState.totalPrice)}\n\nSaldo Anda telah dipotong.`, { parse_mode: 'Markdown' });
        } else {
          // Refund saldo karena API SMM gagal
          await UserService.updateBalance(ctx.from.id, orderState.totalPrice);
          await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
          await ctx.reply(`❌ Gagal membuat order dari server penyedia. Pesan: ${smmResponse.error || 'Server error'}.\nSaldo Anda telah dikembalikan.`);
        }
      } catch (error) {
        // Refund saldo karena sistem error saat menghubungi API SMM
        try { await UserService.updateBalance(ctx.from.id, orderState.totalPrice); } catch(e){}
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
        await ctx.reply(`❌ Terjadi kesalahan sistem saat memproses order: ${error.message}.\nSaldo Anda telah dikembalikan.`);
      }

      return ctx.scene.leave();
    }
  }
);

orderScene.command('cancel', handleCancel);

module.exports = orderScene;
