const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../utils/logger');

const pool = mysql.createPool({
  host: config.DB_HOST,
  user: config.DB_USER,
  password: config.DB_PASS,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection and auto-migrate
pool.getConnection()
  .then(async conn => {
    logger.info('MySQL Database Connected successfully.');
    
    // Auto-migration wrapper
    const autoMigrate = async () => {
      try {
        await conn.query(`ALTER TABLE users ADD COLUMN lock_until DATETIME NULL`);
        logger.info('Migrated: users.lock_until');
      } catch(e) {}
      
      try {
        await conn.query(`ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT FALSE`);
        logger.info('Migrated: users.is_banned');
      } catch(e) {}
      
      try {
        await conn.query(`ALTER TABLE orders ADD COLUMN profit DECIMAL(15,2) DEFAULT 0`);
        logger.info('Migrated: orders.profit');
      } catch(e) {}
      
      try {
        await conn.query(`ALTER TABLE orders ADD COLUMN cost_price DECIMAL(15,2) DEFAULT 0`);
        logger.info('Migrated: orders.cost_price');
      } catch(e) {}

      try {
        await conn.query(`ALTER TABLE orders ADD COLUMN sell_price DECIMAL(15,2) DEFAULT 0`);
        logger.info('Migrated: orders.sell_price');
      } catch(e) {}

      try {
        await conn.query(`ALTER TABLE orders ADD COLUMN category VARCHAR(100) NULL`);
        logger.info('Migrated: orders.category');
      } catch(e) {}

      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS category_margins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            category_name VARCHAR(100) NOT NULL UNIQUE,
            margin_type VARCHAR(20) DEFAULT 'percent',
            margin_value DECIMAL(15,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch(e) {}

      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS settings (
            setting_key VARCHAR(50) PRIMARY KEY,
            setting_value TEXT NOT NULL
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS admin_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            admin_id BIGINT NOT NULL,
            action VARCHAR(255) NOT NULL,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
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
            paid_at TIMESTAMP NULL,
            FOREIGN KEY (user_id) REFERENCES users(telegram_id)
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS refunds (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            user_id BIGINT NOT NULL,
            amount DECIMAL(15,2) NOT NULL,
            reason VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (user_id) REFERENCES users(telegram_id)
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS refills (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            user_id BIGINT NOT NULL,
            api_refill_id VARCHAR(50) NOT NULL,
            status VARCHAR(50) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (user_id) REFERENCES users(telegram_id)
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'admin',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS banks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            bank_name VARCHAR(100) NOT NULL,
            account_number VARCHAR(100) NOT NULL,
            account_name VARCHAR(100) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS qris_accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            qris_name VARCHAR(100) NOT NULL,
            qris_image TEXT NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        try { await conn.query(`ALTER TABLE deposits ADD COLUMN proof_image TEXT`); } catch(e){}
        try { await conn.query(`ALTER TABLE deposits ADD COLUMN admin_id BIGINT`); } catch(e){}
        try { await conn.query(`ALTER TABLE deposits ADD COLUMN approved_at TIMESTAMP NULL`); } catch(e){}
        
        await conn.query(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('markup_percent', '20')`);
      } catch(e) {
        logger.error('Table migration error:', e);
      }
    };
    
    await autoMigrate();
    conn.release();
  })
  .catch(err => {
    logger.error('MySQL Database Connection Error', err);
  });

module.exports = pool;
