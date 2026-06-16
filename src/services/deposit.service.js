const db = require('../database');

class DepositService {
  static async createDeposit(data) {
    const { user_id, reference_id, amount, fee, status, payment_method, pay_url, proof_image } = data;
    
    const safeAmount = Math.floor(Number(amount || 0));
    const safeFee = Math.floor(Number(fee || 0));

    const query = `
      INSERT INTO deposits (user_id, reference_id, amount, fee, status, payment_method, pay_url, proof_image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(query, [
      user_id, reference_id, safeAmount, safeFee, status || 'Pending', payment_method, pay_url, proof_image || null
    ]);
    return result.insertId;
  }

  static async getDepositByRef(reference_id) {
    const [rows] = await db.query('SELECT * FROM deposits WHERE reference_id = ?', [reference_id]);
    return rows[0];
  }

  static async updateDepositStatus(reference_id, status, admin_id = null) {
    let query = `UPDATE deposits SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE reference_id = ? AND status IN ('Pending', 'WAITING_APPROVAL')`;
    let params = [status, reference_id];
    
    if (status === 'Approved' || status === 'Rejected' || status === 'REJECTED') {
        const dbStatus = status.toUpperCase() === 'REJECTED' ? 'Rejected' : 'Approved';
        query = `UPDATE deposits SET status = ?, approved_at = CURRENT_TIMESTAMP, admin_id = ? WHERE reference_id = ? AND status IN ('Pending', 'WAITING_APPROVAL')`;
        params = [dbStatus, admin_id, reference_id];
    }
    
    const [result] = await db.query(query, params);
    return result.affectedRows > 0;
  }

  static async getDepositHistory(user_id, limit = 5) {
     const query = `SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
     const [rows] = await db.query(query, [user_id, limit]);
     return rows;
  }
}

module.exports = DepositService;
