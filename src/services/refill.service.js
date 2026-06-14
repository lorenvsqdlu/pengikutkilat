const db = require('../database');

class RefillService {
  static async createRefill(order_id, user_id, api_refill_id, status = 'Pending') {
    const query = `
      INSERT INTO refills (order_id, user_id, api_refill_id, status)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await db.query(query, [order_id, user_id, api_refill_id, status]);
    return result.insertId;
  }

  static async getRefillCount(order_id) {
    const query = `SELECT COUNT(*) as count FROM refills WHERE order_id = ?`;
    const [rows] = await db.query(query, [order_id]);
    return rows[0].count;
  }

  static async getActiveRefills() {
    const query = `SELECT * FROM refills WHERE status IN ('Pending', 'Processing', 'pending', 'processing')`;
    const [rows] = await db.query(query);
    return rows;
  }

  static async updateRefillStatus(id, status) {
    const query = `UPDATE refills SET status = ? WHERE id = ?`;
    const [result] = await db.query(query, [status, id]);
    return result.affectedRows > 0;
  }
}

module.exports = RefillService;
