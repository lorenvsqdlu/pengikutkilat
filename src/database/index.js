const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../utils/logger');

const pool = mysql.createPool({
  host: config.DB_HOST,
  user: config.DB_USER,
  password: config.DB_PASS,
  port: config.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initDatabase() {
  try {
    const initConn = await mysql.createConnection({
      host: config.DB_HOST,
      user: config.DB_USER,
      password: config.DB_PASS,
      port: config.DB_PORT || 3306
    });
    await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\``);
    await initConn.end();
    logger.info('Database checked/created.');
    
    // Now setup the pool to use the selected database
    const dbPool = mysql.createPool({
      host: config.DB_HOST,
      user: config.DB_USER,
      password: config.DB_PASS,
      database: config.DB_NAME,
      port: config.DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    const conn = await dbPool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username VARCHAR(100),
        fullname VARCHAR(255),
        balance BIGINT DEFAULT 0,
        lock_until DATETIME NULL,
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT,
        service_id INT,
        api_order_id VARCHAR(50),
        category VARCHAR(100),
        target TEXT,
        quantity INT,
        price BIGINT DEFAULT 0,
        cost_price BIGINT DEFAULT 0,
        sell_price BIGINT DEFAULT 0,
        profit BIGINT DEFAULT 0,
        status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`ALTER TABLE orders MODIFY COLUMN cost_price BIGINT DEFAULT 0`).catch(()=>{});
    await conn.query(`ALTER TABLE orders MODIFY COLUMN sell_price BIGINT DEFAULT 0`).catch(()=>{});
    await conn.query(`ALTER TABLE orders MODIFY COLUMN profit BIGINT DEFAULT 0`).catch(()=>{});

    await conn.query(`
      CREATE TABLE IF NOT EXISTS refills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT,
        refill_id VARCHAR(50),
        status VARCHAR(30),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS category_margins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_name VARCHAR(100),
        margin_type ENUM('percent','fixed') DEFAULT 'percent',
        margin_value INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(100) UNIQUE,
        \`value\` TEXT
      )
    `);

    // Fallback for settings if they don't use 'setting_key' anymore, or kept compatibility
    // Make sure we have 'markup_percent' if it's missing
    await conn.query(`INSERT IGNORE INTO settings (\`key\`, \`value\`) VALUES ('markup_percent', '20')`);

    // Other tables needed for the bot to run properly
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        reference_id VARCHAR(100) NOT NULL UNIQUE,
        amount DECIMAL(15,2) NOT NULL,
        fee DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Pending',
        payment_method VARCHAR(50),
        pay_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL
      )
    `);

    conn.release();
    logger.info('MySQL Tables ready.');
    return dbPool;
  } catch (err) {
    logger.error('Database Init Error', err);
    throw err;
  }
}

class DatabaseParams {
  constructor() {
    this.pool = pool; // Default placeholder
  }
  setPool(p) {
    this.pool = p;
  }
  async query(sql, params) {
    if(!this.pool) return [[],[]];
    return this.pool.query(sql, params);
  }
  async execute(sql, params) {
    if(!this.pool) return [[],[]];
    return this.pool.execute(sql, params);
  }
}
const dbInstance = new DatabaseParams();

dbInstance.init = async () => {
    const p = await initDatabase();
    dbInstance.setPool(p);
}

module.exports = dbInstance;
