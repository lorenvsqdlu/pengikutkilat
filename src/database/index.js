const pool = require('../config/database');
const logger = require('../utils/logger');

let isConnected = false;

async function checkConnection() {
  try {
    const client = await pool.connect();
    client.release();
    if (!isConnected) {
        logger.info('[DATABASE CONNECTED] PostgreSQL Connected successfully.');
        isConnected = true;
    }
  } catch (err) {
    logger.error('[DATABASE RECONNECT] Reconnecting... Error: ' + err.message);
    isConnected = false;
    throw err;
  }
}

async function initDatabase() {
  try {
    await checkConnection();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username VARCHAR(100),
        fullname VARCHAR(255),
        balance BIGINT DEFAULT 0,
        lock_until TIMESTAMP NULL,
        admin_login_attempts INTEGER DEFAULT 0,
        admin_lock_until TIMESTAMP NULL,
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        service_id INTEGER,
        service_name VARCHAR(255),
        api_order_id VARCHAR(50),
        external_id VARCHAR(100),
        category VARCHAR(100),
        target TEXT,
        quantity INTEGER,
        price BIGINT DEFAULT 0,
        cost_price BIGINT DEFAULT 0,
        sell_price BIGINT DEFAULT 0,
        profit BIGINT DEFAULT 0,
        start_count INTEGER DEFAULT 0,
        remains INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'pending',
        refund_processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refills (
        id SERIAL PRIMARY KEY,
        order_id INTEGER,
        refill_id VARCHAR(50),
        status VARCHAR(30),
        user_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS category_margins (
        id SERIAL PRIMARY KEY,
        category_name VARCHAR(100) UNIQUE,
        margin_type VARCHAR(20) DEFAULT 'percent',
        margin_value INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders_queue (
        id SERIAL PRIMARY KEY,
        order_id INTEGER,
        user_id BIGINT,
        service_id INTEGER,
        target TEXT,
        quantity INTEGER,
        price BIGINT,
        base_price DECIMAL(15,8),
        category VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        smm_payload TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT
      );
      
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        reference_id VARCHAR(100) NOT NULL UNIQUE,
        amount DECIMAL(15,2) NOT NULL,
        fee DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Pending',
        payment_method VARCHAR(50),
        pay_url TEXT,
        proof_image TEXT,
        admin_id BIGINT NULL,
        approved_at TIMESTAMP NULL,
        paid_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS banks (
        id SERIAL PRIMARY KEY,
        bank_name VARCHAR(100) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        account_name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        user_id BIGINT NOT NULL,
        amount BIGINT NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS balance_mutations (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        type VARCHAR(50) NOT NULL,
        amount BIGINT NOT NULL,
        balance_before BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        description TEXT,
        reference_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS qris_accounts (
        id SERIAL PRIMARY KEY,
        qris_name VARCHAR(100) NOT NULL,
        qris_image TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS admin_logs (
        id SERIAL PRIMARY KEY,
        admin_id BIGINT NOT NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id VARCHAR(100) PRIMARY KEY,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS admin_sessions (
        telegram_id BIGINT PRIMARY KEY,
        session_token TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default settings exist
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', ['markup_percent', '20']);
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', ['welcome_enabled', 'false']);
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', ['welcome_message', 'Halo {first_name},\nSelamat datang di grup kami.']);
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', ['force_subscribe_enabled', 'false']);
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING', ['force_subscribe_channel', '']);

    logger.info('[DATABASE INIT] PostgreSQL Tables initialized.');
    return pool;
  } catch (err) {
    logger.error('[DATABASE INIT ERROR] ' + err.message);
    throw err;
  }
}

class DatabaseParams {
  constructor() {
    this.pool = pool;
  }
  
  // Transform SQLite '?' to Postgres '$1, $2'
  replaceQuestionMarks(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  async query(sql, params = []) {
    let pgSql = this.replaceQuestionMarks(sql);
    const upper = pgSql.trim().toUpperCase();
    
    // Auto-append RETURNING * for INSERTs to simulate insertId
    if (upper.startsWith('INSERT') && !upper.includes('RETURNING')) {
      pgSql = pgSql + ' RETURNING *';
    }

    try {
        const result = await this.pool.query(pgSql, params);
        // Postgres returns result.rows
        const isSelect = upper.startsWith('SELECT');
        if (isSelect || upper.includes('RETURNING *') || upper.includes('RETURNING ID')) {
            const returnedArray = result.rows || [];
            returnedArray.insertId = result.rows[0]?.id || null;
            returnedArray.affectedRows = result.rowCount;
            return [returnedArray, []];
        } else {
            // For updates/inserts without returning actual rows to be matched
            return [{ insertId: result.rows[0]?.id || null, affectedRows: result.rowCount }, []];
        }
    } catch (e) {
        if (!e.message.includes('ECONNREFUSED')) {
            logger.error('[DATABASE ERROR] query failed: ' + e.message + ' | SQL: ' + pgSql);
        }
        throw e;
    }
  }
  
  async execute(sql, params = []) {
    return this.query(sql, params);
  }
  
  async get(sql, params = []) {
    const pgSql = this.replaceQuestionMarks(sql);
    try {
        const result = await this.pool.query(pgSql, params);
        return result.rows[0];
    } catch (e) {
        if (!e.message.includes('ECONNREFUSED')) {
            logger.error('[DATABASE ERROR] get failed: ' + e.message + ' | SQL: ' + pgSql);
        }
        throw e;
    }
  }
}

const dbInstance = new DatabaseParams();

dbInstance.init = async () => {
    await initDatabase();
}

module.exports = dbInstance;
