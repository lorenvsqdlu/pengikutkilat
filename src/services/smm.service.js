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

    try {
      const payload = {
        api_id: this.apiId,
        api_key: this.apiKey,
        ...data
      };

      const response = await this.client.post(endpoint, payload);
      return response.data;
    } catch (error) {
      if (retries > 0) {
        logger.warn(`SMM API Request failed on ${endpoint}, retrying... (${retries} retries left)`);
        return this._request(endpoint, data, retries - 1);
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
        
        servicesList.forEach(s => {
          let cat = s.category || 'Lainnya';
          if (!cat || cat === 'undefined' || cat === 'null' || cat.trim() === '-' || cat.trim() === '') {
              cat = 'Lainnya';
          }
          
          let platform = 'Lainnya';
          const lowerCat = cat.toLowerCase();
          if (lowerCat.includes('instagram')) platform = 'Instagram';
          else if (lowerCat.includes('tiktok')) platform = 'TikTok';
          else if (lowerCat.includes('youtube')) platform = 'Youtube';
          else if (lowerCat.includes('telegram')) platform = 'Telegram';
          else if (lowerCat.includes('facebook')) platform = 'Facebook';
          else if (lowerCat.includes('twitter') || lowerCat.includes('x.com') || lowerCat.includes(' x ')) platform = 'Twitter/X';
          else if (lowerCat.includes('threads')) platform = 'Threads';
          else if (lowerCat.includes('spotify')) platform = 'Spotify';
          else if (lowerCat.includes('website') || lowerCat.includes('traffic')) platform = 'Website Traffic';
          else if (lowerCat.includes('whatsapp') || lowerCat.includes('wa')) platform = 'WhatsApp';
          else if (lowerCat.includes('discord')) platform = 'Discord';
          
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

        
        this.servicesCache = {
          raw: response,
          grouped: groupedArr
        };
        this.servicesCacheTime = Date.now();
        logger.info(`✅ [CACHE] Tersimpan ${servicesList.length} services dari provider ke dalam cache (Masa aktif 10 menit)`);
      }
    }
    
    return this.servicesCache ? this.servicesCache.raw : response;
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
