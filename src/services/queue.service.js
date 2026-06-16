const db = require('../database');

class QueueService {
  static async pushOrder(jobPayload) {
    const parseSafeInt = (val) => {
        const num = Number(val || 0);
        if (!Number.isFinite(num)) throw new Error(`Invalid numeric value detected: ${val}`);
        return Math.floor(num);
    };

    const query = `
      INSERT INTO orders_queue 
      (order_id, user_id, service_id, target, quantity, price, base_price, category, smm_payload, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;
    const params = [
      jobPayload.order_id,
      jobPayload.user_id,
      jobPayload.smm_payload.service,
      jobPayload.smm_payload.target,
      parseSafeInt(jobPayload.quantity),
      parseSafeInt(jobPayload.price),
      jobPayload.base_price, // Leave base price as decimal
      jobPayload.category,
      JSON.stringify(jobPayload.smm_payload)
    ];
    await db.query(query, params);
  }

  static async popOrder() {
    // Atomic pop for PostgreSQL to prevent race conditions across multiple instances
    const query = `
      UPDATE orders_queue 
      SET status = 'processing'
      WHERE id = (
        SELECT id FROM orders_queue 
        WHERE status = 'pending' 
        ORDER BY id ASC 
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) 
      RETURNING *
    `;
    
    let rows;
    try {
        [rows] = await db.query(query);
    } catch (e) {
        throw e;
    }
    
    if (rows && rows.length > 0) {
      const job = rows[0];
      if (typeof job.smm_payload === 'string') {
          try { job.smm_payload = JSON.parse(job.smm_payload); } catch(e){}
      }
      return job;
    }
    return null;
  }

  static async recoverZombieOrders() {
    const fallbackQuery = `
      UPDATE orders_queue 
      SET status = 'pending'
      WHERE status = 'processing' 
      AND created_at < NOW() - INTERVAL '15 minutes'
    `;
    
    let result;
    try {
        [result] = await db.query(fallbackQuery);
    } catch (e) {
        throw e;
    }
    return result.affectedRows;
  }

  static async failOrder(id, retry_count) {
    if (retry_count >= 3) {
      await db.query(`UPDATE orders_queue SET status = 'failed', retry_count = ? WHERE id = ?`, [retry_count, id]);
    } else {
      await db.query(`UPDATE orders_queue SET status = 'pending', retry_count = ? WHERE id = ?`, [retry_count, id]);
    }
  }

  static async completeOrder(id) {
     await db.query(`DELETE FROM orders_queue WHERE id = ?`, [id]);
  }
}

module.exports = QueueService;
