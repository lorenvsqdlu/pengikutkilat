const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class SMMService {
  constructor() {
    this.apiUrl = config.SMM_API_URL || 'https://smmnusantara.id/api';
    this.apiKey = config.SMM_API_KEY;
    this.apiId = config.SMM_API_ID;
    
    // Cache variables
    this.servicesCache = null;
    this.servicesCacheTime = 0;
    this.CACHE_TTL = 10 * 60 * 1000; // 10 menit
    
    // Provider Health Monitor
    this.consecutiveErrors = 0;
    this.isProviderDisabled = false;
    this.disabledUntil = 0;

    if (this.apiUrl) {
      this.client = axios.create({
        baseURL: this.apiUrl,
        timeout: 15000, // 15 detik timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }

  async _request(endpoint, data, retries = 2) {
    if (!this.client) {
      throw new Error('SMM API URL tidak dikonfigurasi.');
    }
    
    if (this.isProviderDisabled && Date.now() < this.disabledUntil) {
        throw new Error('SMM Provider ditangguhkan sementara karena terlalu banyak timeout/error.');
    }

    try {
      const payload = {
        api_id: this.apiId,
        api_key: this.apiKey,
        ...data
      };

      const response = await this.client.post(endpoint, payload);
      
      // Reset errors di sukses
      this.consecutiveErrors = 0;
      this.isProviderDisabled = false;
      
      return response.data;
    } catch (error) {
      if (retries > 0) {
        logger.warn(`SMM API Request failed on ${endpoint}, retrying... (${retries} retries left)`);
        return this._request(endpoint, data, retries - 1);
      }
      
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= 5) { // Threshold 5 berurutan
          this.isProviderDisabled = true;
          this.disabledUntil = Date.now() + (10 * 60 * 1000); // Disable 10 min
          logger.error('CRITICAL: Provider disabled due to 5 consecutive errors/timeouts');
          // Should notify admin if possible, but here we just log
      }
      
      if (error.response) {
        logger.error(`SMM API Error Response [${error.response.status}] on ${endpoint}`, JSON.stringify(error.response.data));
        throw new Error(`SMM API Error: ${error.response.status} - Gagal mengambil data server.`);
      } else if (error.request) {
        logger.error('SMM API Timeout/No Response', error.message);
        throw new Error('SMM API Timeout: Server tidak memberikan respons.');
      } else {
        logger.error('SMM API Request Config Error', error.message);
        throw new Error(`SMM API Request Error: ${error.message}`);
      }
    }
  }

  async testConnection() {
    if (!this.apiUrl || !this.apiKey || !this.apiId) {
      logger.warn('SMM_API_URL, SMM_API_KEY atau SMM_API_ID belum dikonfigurasi. Lewati test SMM API.');
      return false;
    }

    try {
      logger.info('Mencoba melakukan koneksi ke SMM API Nusantara...');
      const response = await this.getBalance();
      
      if (response && response.status === true && response.balance !== undefined) {
        logger.info(`✅ [SMM API SUCCESS] Terhubung ke API. Saldo saat ini: ${response.balance}`);
        return true;
      } else if (response && response.msg) {
        logger.warn(`⚠️ [SMM API TERHUBUNG DENGAN ERROR] Server merespon: ${response.msg}`);
        return false;
      } else {
        logger.info('✅ [SMM API SUCCESS] Terhubung ke API. (Respon API diluar standar)');
        return true;
      }
    } catch (error) {
      logger.error('❌ [SMM API FAILED] Gagal terhubung:', error.message);
      return false;
    }
  }

  async getServices(forceRefresh = false) {
    // Kembalikan dari cache jika masih valid
    if (!forceRefresh && this.servicesCache && (Date.now() - this.servicesCacheTime < this.CACHE_TTL)) {
      return this.servicesCache.raw;
    }

    const response = await this._request('/services', {});
    
    // Amankan dan cache jika data valid
    if (response) {
      let servicesList = [];
      if (response.status === true && Array.isArray(response.services)) {
        servicesList = response.services;
      } else if (Array.isArray(response)) {
        servicesList = response;
      } else if (response.data && Array.isArray(response.data)) {
        servicesList = response.data;
      }
      
      if (servicesList.length > 0) {
        // Group by platform -> category
        const grouped = {};
        const platforms = new Set();
        
        let platformCounts = {
           'Instagram': 0, 'TikTok': 0, 'YouTube': 0, 'Telegram': 0, 'Facebook': 0, 'Twitter/X': 0, 'Threads': 0, 'Spotify': 0, 'Website Traffic': 0, 'WhatsApp': 0, 'Discord': 0, 'LinkedIn': 0, 'Pinterest': 0, 'Twitch': 0, 'Shopee': 0
        };
        
        servicesList.forEach(s => {
          let cat = String(s.category || 'Lainnya');
          if (!cat || cat === 'undefined' || cat === 'null' || cat.trim() === '-' || cat.trim() === '') {
              cat = 'Lainnya';
          }
          
          let platform = 'Lainnya';
          const lowerCat = cat.toLowerCase().trim();
          if (lowerCat.includes('instagram') || lowerCat.match(/\big\b/)) platform = 'Instagram';
          else if (lowerCat.includes('tiktok') || lowerCat.includes('tik tok')) platform = 'TikTok';
          else if (lowerCat.includes('youtube') || lowerCat.match(/\byt\b/)) platform = 'YouTube';
          else if (lowerCat.includes('telegram') || lowerCat.match(/\btg\b/)) platform = 'Telegram';
          else if (lowerCat.includes('facebook') || lowerCat.match(/\bfb\b/)) platform = 'Facebook';
          else if (lowerCat.includes('twitter') || lowerCat.includes('x.com')) platform = 'Twitter/X';
          else if (lowerCat.includes('threads') || lowerCat.match(/\bthread\b/)) platform = 'Threads';
          else if (lowerCat.includes('spotify')) platform = 'Spotify';
          else if (lowerCat.includes('whatsapp') || lowerCat.match(/\bwa\b/)) platform = 'WhatsApp';
          else if (lowerCat.includes('discord')) platform = 'Discord';
          else if (lowerCat.includes('linkedin')) platform = 'LinkedIn';
          else if (lowerCat.includes('pinterest')) platform = 'Pinterest';
          else if (lowerCat.includes('twitch')) platform = 'Twitch';
          else if (lowerCat.includes('shopee')) platform = 'Shopee';
          else if (lowerCat.includes('website') || lowerCat.match(/\btraffic\b/)) platform = 'Website Traffic';
          
          if (platformCounts[platform] !== undefined) platformCounts[platform]++;

          if (!grouped[platform]) grouped[platform] = [];
          grouped[platform].push({
            id: s.id || s.service,
            service: s.service || s.id,
            name: s.name,
            category: cat,
            type: s.type,
            price: s.price || s.rate,
            min: s.min,
            max: s.max,
            description: s.description || '',
            refill: s.refill || false
          });
          platforms.add(platform);
        });
        
        const groupedArr = Object.keys(grouped).map(plat => ({
          platform: plat,
          services: grouped[plat]
        }));
        
        for (const [plat, count] of Object.entries(platformCounts)) {
            if (count === 0) {
                logger.warn(`[HEALTH_CHECK] Platform ${plat} memiliki 0 layanan aktif dari provider!`);
            }
        }

        this.servicesCache = {
          raw: servicesList,
          grouped: groupedArr
        };
        this.servicesCacheTime = Date.now();
        logger.info(`✅ [CACHE] Tersimpan ${servicesList.length} services dari provider ke dalam cache (Masa aktif 10 menit)`);
      }
    }
    
    return this.servicesCache ? this.servicesCache.raw : [];
  }

  getGroupedServices() {
    if (!this.servicesCache) return [];
    return this.servicesCache.grouped;
  }

  searchServices(query) {
     if (!this.servicesCache) return [];
     const lowerKwd = query.toLowerCase();
     const results = [];
     
     this.servicesCache.grouped.forEach(g => {
        // Cari di nama layanan atau nama kategori string
        const matchedServices = g.services.filter(s => s.name.toLowerCase().includes(lowerKwd) || s.category.toLowerCase().includes(lowerKwd));
        if (matchedServices.length > 0 || g.platform.toLowerCase().includes(lowerKwd)) {
           results.push({
              platform: g.platform,
              services: matchedServices.length > 0 ? matchedServices : g.services
           });
        }
     });
     return results;
  }

  async createOrder(serviceData) {
    /* 
      serviceData berisi objek yang disesuaikan dengan jenis service, contoh:
      { service: 9, target: "url", quantity: 100 }
    */
    return this._request('/order', serviceData);
  }

  async getOrderStatus(orderId) {
    return this._request('/status', { id: orderId.toString() });
  }

  async getOrdersStatus(orderIds) {
    return this._request('/status', { id: orderIds.join(',') });
  }

  async getBalance() {
    return this._request('/balance', {});
  }
  
  async refillOrder(orderId) {
    return this._request('/refill', { id: orderId.toString() });
  }
  
  async getRefillStatus(orderId) {
    return this._request('/refill/status', { id: orderId.toString() });
  }
}

module.exports = new SMMService();
