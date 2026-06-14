const db = require('../database');

class UserService {
  /**
   * Get a user by their Telegram ID
   */
  static async getUser(telegramId) {
    const [rows] = await db.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    return rows[0] || null;
  }

  /**
   * Create or update a user's information from Telegram
   */
  static async createUser(userData) {
    const { id, username, first_name, last_name } = userData;
    // Generate fullname
    const fullname = [first_name, last_name].filter(Boolean).join(' ');

    const query = `
      INSERT INTO users (telegram_id, username, fullname, balance)
      VALUES (?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE 
        username = VALUES(username), 
        fullname = VALUES(fullname)
    `;
    const [result] = await db.query(query, [id, username, fullname]);
    return result;
  }

  /**
   * Get all users for broadcast
   */
  static async getAllUsers() {
    const [rows] = await db.query('SELECT telegram_id FROM users WHERE is_banned = 0');
    return rows;
  }
  
  /**
   * Set user ban status
   */
  static async setBanStatus(telegramId, isBanned) {
    const [result] = await db.query('UPDATE users SET is_banned = ? WHERE telegram_id = ?', [isBanned ? 1 : 0, telegramId]);
    return result.affectedRows > 0;
  }

  /**
   * Update a user's balance
   * @param {number} telegramId
   * @param {number} amount (can be negative to decrease)
   */
  static async updateBalance(telegramId, amount) {
    let query;
    if (amount < 0) {
      // Prevent negative balance
      query = `UPDATE users SET balance = balance + ? WHERE telegram_id = ? AND balance + ? >= 0`;
      const [result] = await db.query(query, [amount, telegramId, amount]);
      if (result.affectedRows === 0) {
          throw new Error('Insufficient balance or user not found');
      }
      return result;
    } else {
      query = `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`;
      const [result] = await db.query(query, [amount, telegramId]);
      return result;
    }
  }
}

module.exports = UserService;
