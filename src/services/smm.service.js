const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class SMMService {
  constructor() {
    this.apiUrl = config.SMM_API_URL;
    this.apiKey = config.SMM_API_KEY;
    
    if (this.apiUrl) {
      this.client = axios.create({
        baseURL: this.apiUrl,
        timeout: 10000, // 10 detik timeout
      });
    }
  }

  async _request(data) {
    if (!this.client) {
      throw new Error('SMM API URL tidak dikonfigurasi.');
    }

    try {
      // Kebanyakan API SMM menggunakan x-www-form-urlencoded
      const params = new URLSearchParams();
      
      // Beberapa panel SMM menggunakan parameter 'api_key', lainnya menggunakan 'key'
      params.append('api_key', this.apiKey); 
      params.append('key', this.apiKey);

      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          params.append(key, data[key]);
        }
      }

      const response = await this.client.post('', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`SMM API Error Response [${error.response.status}]`, JSON.stringify(error.response.data));
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
    if (!this.apiUrl || !this.apiKey) {
      logger.warn('SMM_API_URL atau SMM_API_KEY belum dikonfigurasi. Lewati test SMM API.');
      return false;
    }

    try {
      logger.info('Mencoba melakukan koneksi ke SMM API Nusantara...');
      const response = await this.getBalance();
      
      // Berbagai bentuk respon sukses yang umum di SMM
      if (response && response.balance !== undefined) {
        logger.info(`✅ [SMM API SUCCESS] Terhubung ke API. Saldo saat ini: ${response.balance} ${response.currency || 'IDR'}`);
        return true;
      } else if (response && response.error) {
        logger.warn(`⚠️ [SMM API TERHUBUNG DENGAN ERROR] Server merespon: ${response.error}`);
        return false;
      } else {
        logger.info('✅ [SMM API SUCCESS] Terhubung ke API. (Respon API diluar standar /balance)');
        return true;
      }
    } catch (error) {
      logger.error('❌ [SMM API FAILED] Gagal terhubung:', error.message);
      return false;
    }
  }

  async getServices() {
    return this._request({ action: 'services' });
  }

  async createOrder(service, link, quantity, runs, interval) {
    const data = {
      action: 'add',
      service,
      link,
      quantity
    };
    if (runs) data.runs = runs;
    if (interval) data.interval = interval;
    
    return this._request(data);
  }

  async getOrderStatus(orderId) {
    return this._request({ action: 'status', order: orderId });
  }

  async getOrdersStatus(orderIds) {
    return this._request({ action: 'status', orders: orderIds.join(',') });
  }

  async getBalance() {
    return this._request({ action: 'balance' });
  }
}

module.exports = new SMMService();
