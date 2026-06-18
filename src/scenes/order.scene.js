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

// Helper untuk memotong UTF-8 dengan aman (tidak memecah surrogate pair/emoji)
const truncateSafe = (str, len) => {
    if (!str) return '';
    return Array.from(String(str)).slice(0, len).join('');
};

// Helper for Telegram button text sanitization
const sanitizeTelegramText = (text) => {
    if (text === null || typeof text === 'undefined') return '';
    let str = String(text);
    // Remove control characters
    str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    // Remove null bytes
    str = str.replace(/\0/g, '');
    try {
        str = Buffer.from(str, 'utf8').toString('utf8');
    } catch (e) {}
    return str.trim();
};

const cleanAndValidateButtons = (buttons) => {
    return buttons.map(row => {
        return row.filter(btn => {
            if (!btn || !btn.text || typeof btn.text !== 'string') return false;
            let text = btn.text.trim();
            if (text.length === 0) return false;
            try { 
                const bufStr = Buffer.from(btn.text, 'utf8').toString('utf8');
                if (bufStr !== btn.text) return false;
            } catch (e) { return false; }
            if (btn.callback_data && Buffer.byteLength(btn.callback_data, 'utf8') > 64) return false;
            return true; // Valid button
        });
    }).filter(row => row.length > 0); // Remove empty rows
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
        try {
            const platName = sanitizeTelegramText(g.platform);
            if (!platName) return; // Skip invalid platform
            
            if (platName === 'Lainnya') {
                hasLainnya = g.services.length > 0;
                return;
            }
            if (g.services.length > 0) {
                const cbData = `PLATFORM_${g.platform}`;
                if (cbData.length > 64) return; // Safe callback
                row.push(Markup.button.callback(truncateSafe(platName, 40), cbData));
                if (row.length === 2) {
                    buttons.push(row);
                    row = [];
                }
            }
        } catch (e) {
            console.error("[INVALID PLATFORM NAME]", g.platform, e.message);
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
      ...Markup.inlineKeyboard(cleanAndValidateButtons(buttons))
    }).catch(err => {
        const logger = require('../utils/logger');
        logger.error(`[TELEGRAM_RENDER_ERROR] Step 1 Failed: ${err.message}`);
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
      
      let platformName = ctx.wizard.state.order.platform;
      let page = 0;

      if (action.startsWith('PLATFORM_')) {
        await ctx.answerCbQuery().catch(() => {});
        platformName = action.replace('PLATFORM_', '');
        ctx.wizard.state.order.platform = platformName;
      } else if (action === 'BACK_TO_PLATS') {
        // Handled in step 3 but if triggered here
      } else if (action.startsWith('CATPAGE_')) {
        await ctx.answerCbQuery().catch(() => {});
        page = parseInt(action.replace('CATPAGE_', ''), 10) || 0;
      } else {
         await ctx.answerCbQuery().catch(() => {});
         return; // Unhandled
      }
        
      try {
          const logger = require('../utils/logger');
          logger.info(`[PLATFORM_SELECTED]\nplatform=${platformName}\npage=${page}`);
          
          const groupedServices = smmService.getGroupedServices();
          let platformData = groupedServices.find(g => g.platform === platformName);
          
          let normalizedUsed = platformName;
          // Fallback normalizer
          if (!platformData) {
              const normReq = platformName.toLowerCase().replace(/[^a-z0-9]/g, '');
              normalizedUsed = normReq;
              platformData = groupedServices.find(g => g.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === normReq);
          }

          logger.info(`[PLATFORM_NORMALIZED]\nplatform=${normalizedUsed}`);
          
          if (!platformData || !platformData.services || platformData.services.length === 0) {
              logger.error(`[PLATFORM_ERROR]\nplatform=${platformName}\nreason=Data platform kosong atau tidak ditemukan`);
              await sendOrEdit(ctx, `⚠️ Layanan ${platformName} belum tersedia.`);
              return ctx.scene.leave();
          }

          logger.info(`[SERVICES_FOUND]\ncount=${platformData.services.length}`);

          // Ambil unik kategori pada platform tersebut
          const categoriesSet = new Set();
          platformData.services.forEach(s => {
              if (s && s.category) categoriesSet.add(s.category);
              else categoriesSet.add('Lainnya');
          });
          
          // Pisahkan "Lainnya" agar ada di akhir jika ada (atau skip jika tidak ada)
          let categories = Array.from(categoriesSet);
          let hasCatLainnya = false;
          if (categories.includes('Lainnya')) {
              hasCatLainnya = true;
              categories = categories.filter(c => c !== 'Lainnya');
          }
          
          categories.sort(); // Optional sorting by alphabetical

          // Mapping for callback state
          if (!ctx.wizard.state.catMapList) ctx.wizard.state.catMapList = [];

          const ITEMS_PER_PAGE = 10;
          const totalPages = Math.ceil(categories.length / ITEMS_PER_PAGE) || 1;
          const startIndex = page * ITEMS_PER_PAGE;
          const paginatedCats = categories.slice(startIndex, startIndex + ITEMS_PER_PAGE);

          const buttons = [];
          
          paginatedCats.forEach((cat, indexInPage) => {
              try {
                  let safeCat = sanitizeTelegramText(cat);
                  if (!safeCat) safeCat = 'Lainnya';
                  
                  const globalIndex = startIndex + indexInPage;
                  const callbackData = `CAT_${globalIndex}`;
                  ctx.wizard.state.catMapList[globalIndex] = safeCat;
                  buttons.push([Markup.button.callback(truncateSafe(safeCat, 40), callbackData)]);
              } catch (e) {
                  console.error("[INVALID CATEGORY NAME]", cat, e.message);
              }
          });
          
          // Append Lainnya if we are on the last page and it exists
          if (hasCatLainnya && page === totalPages - 1) {
              const globalIndex = categories.length; // index after the sorted categories
              const callbackData = `CAT_${globalIndex}`;
              ctx.wizard.state.catMapList[globalIndex] = 'Lainnya';
              buttons.push([Markup.button.callback('Lainnya', callbackData)]);
          }

          // Pagination buttons
          const paginationButtons = [];
          if (page > 0) {
              paginationButtons.push(Markup.button.callback('◀️', `CATPAGE_${page - 1}`));
          }
          if (page < totalPages - 1) {
              paginationButtons.push(Markup.button.callback('▶️', `CATPAGE_${page + 1}`));
          }
          if (paginationButtons.length > 0) {
              buttons.push(paginationButtons);
          }

          buttons.push([Markup.button.callback('🔙 Kembali', 'BACK_TO_PLATS')]);
          buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

          const finalButtons = cleanAndValidateButtons(buttons);
          await sendOrEdit(ctx, `📄 Pilih Kategori ${platformName} (Hal ${page + 1}/${totalPages}):`, {
            ...Markup.inlineKeyboard(finalButtons)
          });
          
          if (action.startsWith('PLATFORM_') || action === 'BACK_TO_PLATS') {
              return ctx.wizard.next();
          } else {
              return; // Stay in the same step
          }
      } catch (e) {
          const logger = require('../utils/logger');
          logger.error(`[CATEGORY_ERROR] Error in category render:\nuser_id=${ctx.from.id}\ncallback=${action}\nplatform=${platformName}\ncategory=null\nservice_id=null\nstack=${e.stack}`);
          if (e.message && e.message.includes('button')) {
              logger.error(`[TELEGRAM_RENDER_ERROR] Failed to render categories inline keyboard: ${e.message}`);
          }
          await sendOrEdit(ctx, `❌ Terjadi kesalahan saat memuat layanan. Error: ${e.message}`);
          return ctx.scene.leave();
      }
    } catch (err) {
      const logger = require('../utils/logger');
      const actionFallback = ctx.callbackQuery ? ctx.callbackQuery.data : 'unknown';
      logger.error(`[PLATFORM_ERROR] Step 2 failed:\nuser_id=${ctx.from.id}\ncallback=${actionFallback}\nplatform=${ctx.wizard.state.order.platform || 'null'}\ncategory=null\nservice_id=null\nstack=${err.stack}`);
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
    
    let selectedCategory = ctx.wizard.state.order.category;
    let page = 0;

    if (action.startsWith('CAT_')) {
        await ctx.answerCbQuery().catch(() => {});
        const index = action.replace('CAT_', '');
        selectedCategory = ctx.wizard.state.catMapList[index];
        if (!selectedCategory) {
            await sendOrEdit(ctx, 'Kategori tidak valid atau sesi kadaluwarsa.');
            return ctx.scene.leave();
        }
        ctx.wizard.state.order.category = selectedCategory;
    } else if (action.startsWith('SRVPAGE_')) {
        await ctx.answerCbQuery().catch(() => {});
        page = parseInt(action.replace('SRVPAGE_', ''), 10) || 0;
    } else {
        await ctx.answerCbQuery().catch(() => {});
        return; // Unhandled
    }
        
    const logger = require('../utils/logger');
    logger.info(`[SERVICE_CATEGORY]\ncategory=${selectedCategory}\npage=${page}`);
    
    try {
        const groupedServices = smmService.getGroupedServices();
        if (!groupedServices || groupedServices.length === 0) {
             logger.warn(`[CACHE MISS] No cached services found during order flow.`);
             throw new Error('Cache layanan kosong. Silakan coba lagi.');
        }
        
        let platformData = groupedServices.find(g => g.platform === ctx.wizard.state.order.platform);
        
        if (!platformData) {
            const normReq = ctx.wizard.state.order.platform.toLowerCase().replace(/[^a-z0-9]/g, '');
            platformData = groupedServices.find(g => g.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === normReq);
        }
        
        if (!platformData) {
            logger.error(`[PLATFORM_ERROR]\nplatform=${ctx.wizard.state.order.platform}\nreason=Data platform tidak ditemukan setelah normalisasi`);
            throw new Error('Data platform tidak ditemukan');
        }

        const filteredServices = platformData.services
            .filter(s => {
                let safeCat = sanitizeTelegramText(s.category);
                if (!safeCat) safeCat = 'Lainnya';
                return safeCat === selectedCategory;
            });
        
        if (filteredServices.length === 0) {
            await sendOrEdit(ctx, 'Maaf, layanan tidak tersedia saat ini.');
            return ctx.scene.leave();
        }

        // Simpan semua service yang difilter agar bisa diakses oleh Step berikutnya (snapshot)
        ctx.wizard.state.availableServices = filteredServices;
        const ProfitEngine = require('../services/profit.engine');

        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.ceil(filteredServices.length / ITEMS_PER_PAGE) || 1;
        const startIndex = page * ITEMS_PER_PAGE;
        const paginatedServices = filteredServices.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        
        let servicesRendered = 0;
        let servicesSkipped = 0;

        const buttons = [];
        for (const s of paginatedServices) {
            try {
                if (!s.service) {
                    logger.warn(`[SERVICE DATA WARNING] Terdeteksi service tanpa ID:`, s);
                    servicesSkipped++;
                    continue;
                }
                const basePrice = parseFloat(s.price || s.rate || 0);
                const p = await ProfitEngine.calculatePrice(basePrice, 1000, s.category);
                
                let safeName = '';
                if (s.name === null || typeof s.name === 'undefined') {
                    safeName = `Layanan #${s.service}`;
                } else {
                    safeName = sanitizeTelegramText(s.name);
                    if (safeName === '') {
                        console.error(`[SERVICE SKIPPED]\nid=${s.service}\nreason=invalid utf8`);
                        servicesSkipped++;
                        continue;
                    }
                }
                
                const label = `${truncateSafe(safeName, 40)} | ${formatRupiah(p.sell_price)}/K`;
                let cbData = `SERVICE_${s.service}`;
                if (Buffer.byteLength(cbData, 'utf8') > 64) {
                    logger.warn(`[CALLBACK DATA WARNING] Callback terlalu panjang: ${cbData}`);
                    cbData = `SERVICE_${s.service}`.substring(0, 64);
                }
                buttons.push([Markup.button.callback(label, cbData)]);
                servicesRendered++;
            } catch (e) {
                servicesSkipped++;
                console.error("[INVALID SERVICE NAME]", s.service, JSON.stringify(s.name), e.message);
            }
        }
        
        if (buttons.length === 0) {
            await sendOrEdit(ctx, 'Maaf, ada kendala render layanan untuk kategori ini.');
            return ctx.scene.leave();
        }
        
        // Pagination buttons
        const paginationButtons = [];
        if (page > 0) {
            paginationButtons.push(Markup.button.callback('◀️', `SRVPAGE_${page - 1}`));
        }
        if (page < totalPages - 1) {
            paginationButtons.push(Markup.button.callback('▶️', `SRVPAGE_${page + 1}`));
        }
        if (paginationButtons.length > 0) {
            buttons.push(paginationButtons);
        }
        
        buttons.push([Markup.button.callback('🔙 Kembali', `PLATFORM_${ctx.wizard.state.order.platform}`)]);
        buttons.push([Markup.button.callback('❌ Batal', 'CANCEL')]);

        const finalButtons = cleanAndValidateButtons(buttons);
        if (finalButtons.length === 0 || (finalButtons.length <= 2 && servicesRendered > 0)) {
            if (finalButtons.length === 0) {
                await sendOrEdit(ctx, 'Maaf, gagal menampilkan layanan karena error format.');
                return ctx.scene.leave();
            }
        }

        await sendOrEdit(ctx, `Layanan dalam ${selectedCategory} (Hal ${page + 1}/${totalPages}):`, {
            ...Markup.inlineKeyboard(finalButtons)
        });
        
        if (action.startsWith('CAT_')) {
            return ctx.wizard.next();
        } else {
            return; // SRVPAGE stays in step
        }

    } catch (error) {
        const logger = require('../utils/logger');
        logger.error(`[SERVICE_ERROR] Error in service render:\nuser_id=${ctx.from.id}\ncallback=${action}\nplatform=${ctx.wizard.state.order.platform}\ncategory=${selectedCategory}\nservice_id=null\nstack=${error.stack}`);
        if (error.message && error.message.includes('button')) {
            logger.error(`[TELEGRAM_RENDER_ERROR] Failed to render services inline keyboard: ${error.message}`);
        }
        await sendOrEdit(ctx, '❌ Terjadi kesalahan saat mengambil layanan SMM. Silakan coba menu lagi.').catch(()=>({}));
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

          // RE-VALIDATE SERVICE AND PRICE - SKIP FETCHING FROM PROVIDER AGAIN!
          // Use the snapshot captured during selection to prevent order failures if provider temporarily goes down
          const orderState = ctx.wizard.state.order;
          const user = await UserService.getUser(userId);

          if (!user) {
            await ctx.reply('User tidak ditemukan. Ketik /start');
            return ctx.scene.leave();
          }
          
          const latestService = orderState.selectedService;
          
          if (!latestService) {
              await ctx.reply('❌ Sesi order tidak valid. Silahkan ulangi order.');
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
          const orderState = ctx.wizard.state.order || {};
          logger.error(`[ORDER_ERROR] Error saat submit order queue:\nuser_id=${userId}\nservice_id=${orderState.selectedService ? orderState.selectedService.service : 'null'}\nstack=${error.stack}`);
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
