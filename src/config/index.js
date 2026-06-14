require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  PORT: process.env.PORT || 3000,
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASS: process.env.DB_PASS,
  DB_NAME: process.env.DB_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  SMM_API_URL: process.env.SMM_API_URL || '',
  SMM_API_KEY: process.env.SMM_API_KEY || '',
  MARKUP_PERCENT: parseFloat(process.env.MARKUP_PERCENT) || 20, // Default fallback
  ADMIN_IDS: process.env.ADMIN_IDS || '',
  TRIPAY_API_KEY: process.env.TRIPAY_API_KEY || '',
  TRIPAY_PRIVATE_KEY: process.env.TRIPAY_PRIVATE_KEY || '',
  TRIPAY_MERCHANT_CODE: process.env.TRIPAY_MERCHANT_CODE || '',
  TRIPAY_IS_PRODUCTION: process.env.TRIPAY_IS_PRODUCTION === 'true'
};
