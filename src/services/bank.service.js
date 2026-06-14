const db = require('../database');

class BankService {
  static async addBank(bank_name, account_number, account_name) {
    const query = `INSERT INTO banks (bank_name, account_number, account_name) VALUES (?, ?, ?)`;
    const [res] = await db.query(query, [bank_name, account_number, account_name]);
    return res.insertId;
  }
  
  static async getActiveBanks() {
    const [rows] = await db.query(`SELECT * FROM banks WHERE is_active = TRUE`);
    return rows;
  }
  
  static async getAllBanks() {
    const [rows] = await db.query(`SELECT * FROM banks`);
    return rows;
  }
  
  static async getBankById(id) {
    const [rows] = await db.query(`SELECT * FROM banks WHERE id = ?`, [id]);
    return rows[0];
  }

  static async updateBank(id, bank_name, account_number, account_name) {
    const query = `UPDATE banks SET bank_name=?, account_number=?, account_name=? WHERE id=?`;
    await db.query(query, [bank_name, account_number, account_name, id]);
  }
  
  static async toggleActive(id, is_active) {
    const query = `UPDATE banks SET is_active=? WHERE id=?`;
    await db.query(query, [is_active, id]);
  }
  
  static async deleteBank(id) {
    await db.query(`DELETE FROM banks WHERE id=?`, [id]);
  }
}

module.exports = BankService;
