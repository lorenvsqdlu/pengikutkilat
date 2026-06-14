require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  PORT: process.env.PORT || 3000,
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASS: process.env.DB_PASS,
  DB_NAME: process.env.DB_NAME,
  SMM_API_URL: 'https://smmnusantara.id/api',
  SMM_API_KEY: process.env.SMM_API_KEY || '',
  SMM_API_ID: process.env.SMM_API_ID ? parseInt(process.env.SMM_API_ID, 10) : 0,
  MARKUP_PERCENT: parseFloat(process.env.MARKUP_PERCENT) || 20, // Default fallback
  ADMIN_IDS: process.env.ADMIN_IDS || ''
};
