const db = require('../database');

class QueueService {
  static async pushOrder(jobPayload) {
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
      jobPayload.quantity,
      jobPayload.price,
      jobPayload.base_price,
      jobPayload.category,
      JSON.stringify(jobPayload.smm_payload)
    ];
    await db.query(query, params);
  }

  static async popOrder() {
    // SQLite does not support SELECT FOR UPDATE properly if simple, but we can do it via a simple UPDATE with returning or SELECT then UPDATE.
    // However, since max concurrency is 1, a simple SELECT then UPDATE works in Node single thread.
    const [rows] = await db.query(`SELECT * FROM orders_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 1`);
    if (rows && rows.length > 0) {
      const job = rows[0];
      await db.query(`UPDATE orders_queue SET status = 'processing' WHERE id = ?`, [job.id]);
      job.smm_payload = JSON.parse(job.smm_payload);
      return job;
    }
    return null;
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
