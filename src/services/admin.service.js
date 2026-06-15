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
    await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [key, value]);
  }
}

module.exports = AdminService;
