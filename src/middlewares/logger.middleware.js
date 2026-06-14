const logger = require('../utils/logger');

/**
 * Global logging middleware for Telegraf
 */
module.exports = async (ctx, next) => {
  const start = new Date();
  logger.info(`Received update type: ${ctx.updateType}`);
  
  await next();
  
  const ms = new Date() - start;
  logger.info(`Processed update in ${ms}ms`);
};
