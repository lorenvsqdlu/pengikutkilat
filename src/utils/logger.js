const winston = require('winston');
const path = require('path');

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let result = `[${level.toUpperCase()}] ${timestamp} - ${message}`;
    
    // Include error stack or any additional metadata if present
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    if (metaStr && metaStr !== '{}') {
        result += ` ${metaStr}`;
    }
    // winston passes error object properties as well
    if (meta && meta.stack) {
        result += `\n${meta.stack}`;
    } else if (meta && meta.message && meta.message !== message) {
        result += `\n${meta.message}`;
    }
    
    return result;
  })
);

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/app.log') })
  ]
});

module.exports = logger;
