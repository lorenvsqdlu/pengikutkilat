const db = require('../database');

class AdminService {
  static async logAction(adminId, action, details) {
    await db.query(`INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)`, [adminId, action, JSON.stringify(details)]);
  }

  static async getStats() {
    const totalUsersRes = await db.query(`SELECT COUNT(*) as total_users FROM users`);
    const total_users = totalUsersRes[0][0]?.total_users || 0;

    const totalOrdersRes = await db.query(`SELECT COUNT(*) as total_orders, SUM(profit) as total_profit FROM orders`);
    const total_orders = totalOrdersRes[0][0]?.total_orders || 0;
    const total_profit = totalOrdersRes[0][0]?.total_profit || 0;
    return { 
      total_users, 
      total_orders, 
      total_profit: total_profit || 0 
    };
  }

  static async getSetting(key) {
    const [rows] = await db.query(`SELECT setting_value FROM settings WHERE setting_key = ?`, [key]);
    return rows.length ? rows[0].setting_value : null;
  }

  static async setSetting(key, value) {
    try {
        const [updateRes] = await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ? RETURNING *', [value, key]);
        if (!updateRes || updateRes.length === 0) {
            await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
        }
        const logger = require('../utils/logger');
        const shortKey = key.replace('_message', '').replace('_channel', '').replace('force_subscribe', 'FORCESUB');
        if (shortKey.includes('FORCESUB')) {
            logger.info(`[FORCESUB] channel updated`);
            logger.info(`[FORCESUB] settings reloaded`);
        } else {
            logger.info(`[SETTINGS] ${shortKey} updated`);
            logger.info(`[SETTINGS] ${shortKey} reloaded`);
        }
    } catch (e) {
        const logger = require('../utils/logger');
        logger.error(`Failed to set setting ${key}: ${e.message}`);
        throw e;
    }
  }
}

module.exports = AdminService;
