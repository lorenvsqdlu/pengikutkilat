const logger = require('./logger');

const renderTemplate = (template, user, botInfo) => {
    if (!template) return '';
    
    const bot_name = botInfo ? (botInfo.first_name || botInfo.username || 'Bot') : 'Bot';
    const first_name = user ? (user.first_name || '') : '';
    const last_name = user ? (user.last_name || '') : '';
    const username = user && user.username ? '@' + user.username : '';
    const user_id = user ? (user.id || user.telegram_id || '') : '';
    
    logger.info(`[WELCOME_TEMPLATE]\ntemplate=${template.substring(0, 100)}`);
    
    const message = String(template)
        .replace(/{bot_name}/g, bot_name)
        .replace(/{first_name}/g, first_name)
        .replace(/{last_name}/g, last_name)
        .replace(/{username}/g, username)
        .replace(/{user_id}/g, user_id)
        .replace(/{id}/g, user_id); // legacy support
        
    logger.info(`[WELCOME_RENDER]\nbot_name=${bot_name}\nfirst_name=${first_name}\nusername=${username}`);
    logger.info(`[WELCOME_FINAL]\nmessage=${message.substring(0, 100)}`);
    
    return message;
};

module.exports = {
    renderTemplate
};
