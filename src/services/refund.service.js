const db = require('../database');

class RefundService {
  static async processRefund(order_id, user_id, amount, reason) {
    const rawVal = Number(amount || 0);
    if (!Number.isFinite(rawVal)) throw new Error('Invalid amount');
    const safeAmount = Math.floor(rawVal);
    if (safeAmount <= 0) return 0;

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // Lock row safely
        const orderRes = await client.query('SELECT refund_processed FROM orders WHERE id = $1 FOR UPDATE', [order_id]);
        if (orderRes.rows.length === 0 || orderRes.rows[0].refund_processed) {
            await client.query('ROLLBACK');
            return 0; // Already processed
        }

        await client.query('UPDATE orders SET refund_processed = TRUE WHERE id = $1', [order_id]);
        
        const insertRefund = await client.query(`
            INSERT INTO refunds (order_id, user_id, amount, reason) VALUES ($1, $2, $3, $4) RETURNING id
        `, [order_id, user_id, safeAmount, reason]);
        
        const UserService = require('./user.service');
        // Because UserService.updateBalance creates its own transaction using pool.connect(), 
        // we should either invoke it without its transaction or replicate the logic here.
        // It's safer to replicate the balance update here to be in the same transaction.
        
        const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE', [user_id]);
        if (userRes.rows.length > 0) {
             const balanceBefore = Math.floor(Number(userRes.rows[0].balance));
             const balanceAfter = balanceBefore + safeAmount;
             await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [balanceAfter, user_id]);
             await client.query(`
                INSERT INTO balance_mutations (user_id, type, amount, balance_before, balance_after, description, reference_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
             `, [user_id, 'Refund', Math.abs(safeAmount), balanceBefore, balanceAfter, reason, order_id.toString()]);
        }

        await client.query('COMMIT');
        return insertRefund.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
  }

  static async hasRefunded(order_id) {
    const query = `SELECT id FROM refunds WHERE order_id = ?`;
    const [rows] = await db.query(query, [order_id]);
    return rows.length > 0;
  }
}

module.exports = RefundService;
