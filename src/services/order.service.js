const db = require('../database');
const logger = require('../utils/logger');

class OrderService {
  static async createOrder(orderData) {
    const { user_id, service_id, target, quantity, price, profit, cost_price, sell_price, category, api_order_id, status } = orderData;
    const query = `
      INSERT INTO orders (user_id, service_id, target, quantity, price, profit, cost_price, sell_price, category, api_order_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(query, [
      user_id, service_id, target, quantity, price, profit || 0, cost_price || 0, sell_price || 0, category || '', api_order_id || null, status || 'Pending'
    ]);
    return result.insertId;
  }

  static async getOrdersByUser(user_id, limit = 5) {
    const query = `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
    const [rows] = await db.query(query, [user_id, limit]);
    return rows;
  }

  static async getOrderById(order_id) {
    const query = `SELECT * FROM orders WHERE id = ?`;
    const [rows] = await db.query(query, [order_id]);
    return rows.length ? rows[0] : null;
  }

  static async getActiveOrders() {
    const query = `SELECT * FROM orders WHERE status IN ('Pending', 'Processing', 'In progress', 'In Progress')`;
    const [rows] = await db.query(query);
    return rows;
  }

  static async updateOrderStatus(id, status) {
    const query = `UPDATE orders SET status = ? WHERE id = ?`;
    const [result] = await db.query(query, [status, id]);
    return result.affectedRows > 0;
  }
}

module.exports = OrderService;
