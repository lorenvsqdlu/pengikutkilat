const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Pool } = require('pg');
require('dotenv').config();

const sqlitePath = process.env.DB_PATH || './data/bot.sqlite';
const pgUrl = process.env.DATABASE_URL;

if (!pgUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
}

const pool = new Pool({
  connectionString: pgUrl
});

async function migrate() {
    console.log('[MIGRATION] Starting migration...');
    const db = await open({
        filename: sqlitePath,
        driver: sqlite3.Database
    });

    const client = await pool.connect();
    
    try {
        console.log('Migrating users...');
        const users = await db.all('SELECT * FROM users');
        for (const user of users) {
             await client.query(`
                INSERT INTO users (id, telegram_id, username, fullname, balance, lock_until, is_banned, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
             `, [user.id, user.telegram_id, user.username, user.fullname, user.balance, user.lock_until, user.is_banned, user.created_at]);
        }
        
        // Reset sequence
        await client.query(\`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id)+1 FROM users), 1), false);\`);

        console.log('Migrating orders...');
        const orders = await db.all('SELECT * FROM orders');
        for (const order of orders) {
             await client.query(`
                INSERT INTO orders (id, user_id, service_id, service_name, api_order_id, category, target, quantity, price, cost_price, sell_price, profit, start_count, remains, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO NOTHING
             `, [order.id, order.user_id, order.service_id, order.service_name, order.api_order_id, order.category, order.target, order.quantity, order.price, order.cost_price, order.sell_price, order.profit, order.start_count, order.remains, order.status, order.created_at]);
        }
        await client.query(\`SELECT setval('orders_id_seq', COALESCE((SELECT MAX(id)+1 FROM orders), 1), false);\`);

        console.log('Migrating deposits...');
        const deposits = await db.all('SELECT * FROM deposits');
        for (const dep of deposits) {
             await client.query(`
                INSERT INTO deposits (id, user_id, reference_id, amount, fee, status, payment_method, pay_url, proof_image, admin_id, approved_at, paid_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO NOTHING
             `, [dep.id, dep.user_id, dep.reference_id, dep.amount, dep.fee, dep.status, dep.payment_method, dep.pay_url, dep.proof_image, dep.admin_id, dep.approved_at, dep.paid_at, dep.created_at]);
        }
        await client.query(\`SELECT setval('deposits_id_seq', COALESCE((SELECT MAX(id)+1 FROM deposits), 1), false);\`);

        console.log('Migrating refills...');
        const refills = await db.all('SELECT * FROM refills');
        for (const r of refills) {
             let userId = null; // Adjust if user_id wasn't in old schema
             await client.query(`
                INSERT INTO refills (id, order_id, refill_id, status, created_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
             `, [r.id, r.order_id, r.refill_id, r.status, r.created_at]);
        }
        await client.query(\`SELECT setval('refills_id_seq', COALESCE((SELECT MAX(id)+1 FROM refills), 1), false);\`);

        console.log('Migrating settings...');
        const settings = await db.all('SELECT * FROM settings');
        for (const s of settings) {
             await client.query(`
                INSERT INTO settings (setting_key, setting_value)
                VALUES ($1, $2)
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
             `, [s.setting_key, s.setting_value]);
        }
        
        console.log('Migrating categories...');
        const cats = await db.all('SELECT * FROM category_margins');
        for (const c of cats) {
             await client.query(`
                INSERT INTO category_margins (id, category_name, margin_type, margin_value, created_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
             `, [c.id, c.category_name, c.margin_type, c.margin_value, c.created_at]);
        }
        await client.query(\`SELECT setval('category_margins_id_seq', COALESCE((SELECT MAX(id)+1 FROM category_margins), 1), false);\`);

        console.log('[MIGRATION] Migration successfully finished!');
    } catch(err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
