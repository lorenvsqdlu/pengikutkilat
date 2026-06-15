const logger = require('../utils/logger');

/**
 * Global logging middleware for Telegraf
 */
module.exports = async (ctx, next) => {
  const start = new Date();
  
  if (ctx.updateType === 'message') {
      logger.info(`[MESSAGE] User ${ctx.from?.id} : ${ctx.message?.text || '<non-text message>'}`);
  } else if (ctx.updateType === 'callback_query') {
      logger.info(`[CALLBACK] User ${ctx.from?.id} : ${ctx.callbackQuery?.data}`);
  } else {
      logger.info(`[UPDATE] Type: ${ctx.updateType} from User ${ctx.from?.id || 'Unknown'}`);
  }
  
  await next();
  
  const ms = new Date() - start;
  logger.info(`[PROCESSED] ${ctx.updateType} in ${ms}ms`);
};
