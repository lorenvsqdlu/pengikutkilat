const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

class PaymentService {
  constructor() {
    this.apiKey = config.TRIPAY_API_KEY;
    this.privateKey = config.TRIPAY_PRIVATE_KEY;
    this.merchantCode = config.TRIPAY_MERCHANT_CODE;
    this.isProduction = config.TRIPAY_IS_PRODUCTION;
    this.baseUrl = this.isProduction 
      ? 'https://tripay.co.id/api' 
      : 'https://tripay.co.id/api-sandbox';
  }

  async createTransaction(user, amount, method = 'QRIS') {
    if (!this.apiKey || !this.privateKey || !this.merchantCode) {
      throw new Error('Payment Gateway belum dikonfigurasi. Silakan hubungi admin.');
    }

    const merchantRef = 'DEP-' + Date.now() + '-' + user.id;
    const signature = crypto.createHmac('sha256', this.privateKey)
      .update(this.merchantCode + merchantRef + amount)
      .digest('hex');

    const payload = {
      method,
      merchant_ref: merchantRef,
      amount,
      customer_name: user.fullname || user.username || 'User',
      customer_email: `${user.id}@telegram.bot.local`,
      customer_phone: '081234567890',
      order_items: [
        {
          sku: 'DEP-' + amount,
          name: 'Deposit Saldo',
          price: amount,
          quantity: 1
        }
      ],
      signature
    };

    try {
      const response = await axios.post(`${this.baseUrl}/transaction/create`, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data.data; // Mengembalikan data transaksi Tripay
    } catch (error) {
      logger.error('PaymentService.createTransaction Error', error.response ? JSON.stringify(error.response.data) : error.message);
      throw new Error(error.response?.data?.message || 'Gagal membuat transaksi ke Payment Gateway.');
    }
  }

  verifyCallback(body, signatureHeader) {
     const signature = crypto.createHmac('sha256', this.privateKey)
        .update(JSON.stringify(body))
        .digest('hex');
     return signature === signatureHeader;
  }
}

module.exports = new PaymentService();
