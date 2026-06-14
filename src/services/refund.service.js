const db = require('../database');

class RefundService {
  static async createRefund(order_id, user_id, amount, reason) {
    const query = `
      INSERT INTO refunds (order_id, user_id, amount, reason)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM refunds WHERE order_id = ?)
    `;
    const [result] = await db.query(query, [order_id, user_id, amount, reason, order_id]);
    return result.insertId;
  }

  static async hasRefunded(order_id) {
    const query = `SELECT id FROM refunds WHERE order_id = ?`;
    const [rows] = await db.query(query, [order_id]);
    return rows.length > 0;
  }
}

module.exports = RefundService;
