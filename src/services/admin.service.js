const db = require('../database');

class AdminService {
  static async logAction(adminId, action, details) {
    await db.query(`INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)`, [adminId, action, JSON.stringify(details)]);
  }

  static async getStats() {
    const [[{ total_users }]] = await db.query(`SELECT COUNT(*) as total_users FROM users`);
    const [[{ total_orders, total_profit }]] = await db.query(`SELECT COUNT(*) as total_orders, SUM(profit) as total_profit FROM orders`);
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
    await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [key, value]);
  }
}

module.exports = AdminService;
