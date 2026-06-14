require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  PORT: process.env.PORT || 3000,
  DB_PATH: process.env.DB_PATH || './data/bot.sqlite',
  SMM_API_URL: 'https://smmnusantara.id/api',
  SMM_API_KEY: process.env.SMM_API_KEY || '',
  SMM_API_ID: process.env.SMM_API_ID ? parseInt(process.env.SMM_API_ID, 10) : 0,
  MARKUP_PERCENT: parseFloat(process.env.MARKUP_PERCENT) || 20, // Default fallback
  ADMIN_IDS: process.env.ADMIN_IDS || ''
};
