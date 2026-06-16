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
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username, 
        fullname = excluded.fullname
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
    const [result] = await db.query('UPDATE users SET is_banned = ? WHERE telegram_id = ?', [!!isBanned, telegramId]);
    return result.affectedRows > 0;
  }

  /**
   * Check if user is locked
   */
  static async isLocked(telegramId) {
    const [rows] = await db.query('SELECT lock_until FROM users WHERE telegram_id = ?', [telegramId]);
    if (!rows[0] || !rows[0].lock_until) return false;
    const lockUntil = new Date(rows[0].lock_until).getTime();
    return lockUntil > Date.now();
  }

  /**
   * Set lock_until for user (seconds)
   */
  static async setLock(telegramId, seconds) {
    const lockTime = new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const query = `UPDATE users SET lock_until = ? WHERE telegram_id = ?`;
    await db.query(query, [lockTime, telegramId]);
  }

  /**
   * Update a user's balance and record mutation
   * @param {number} telegramId
   * @param {number} amount (can be negative to decrease)
   * @param {string} type e.g., 'Deposit', 'Order', 'Refund'
   * @param {string} description Note about the mutation
   * @param {string} referenceId order or deposit ID
   */
  static async updateBalance(telegramId, amount, type = 'System', description = '', referenceId = null) {
    const rawVal = Number(amount || 0);
    if (!Number.isFinite(rawVal)) {
      throw new Error('Invalid numeric value detected for balance update');
    }
    const safeAmount = Math.floor(rawVal);
    
    // We use a transaction because we need to read the balance, update it, and insert mutation
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // Lock user row
        const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
        if (userRes.rows.length === 0) throw new Error('User not found');
        
        const balanceBefore = Math.floor(Number(userRes.rows[0].balance));
        const balanceAfter = balanceBefore + safeAmount;
        
        if (safeAmount < 0 && balanceAfter < 0) {
            throw new Error('Insufficient balance');
        }
        
        await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [balanceAfter, telegramId]);
        
        if (safeAmount !== 0) {
            await client.query(`
                INSERT INTO balance_mutations (user_id, type, amount, balance_before, balance_after, description, reference_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [telegramId, type, Math.abs(safeAmount), balanceBefore, balanceAfter, description, referenceId]);
        }
        
        await client.query('COMMIT');
        return { affectedRows: 1 };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
  }
}

module.exports = UserService;
