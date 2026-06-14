const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let db = null;

async function checkDataDir() {
  const dbPath = config.DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created database directory: ${dir}`);
  }
}

async function connectDB() {
  await checkDataDir();
  db = await open({
    filename: config.DB_PATH,
    driver: sqlite3.Database
  });
  logger.info('SQLite Database Connected successfully.');
  return db;
}

async function initDatabase() {
  try {
    if (!db) await connectDB();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id BIGINT UNIQUE,
        username VARCHAR(100),
        fullname VARCHAR(255),
        balance BIGINT DEFAULT 0,
        lock_until DATETIME NULL,
        is_banned BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id BIGINT,
        service_id INTEGER,
        api_order_id VARCHAR(50),
        category VARCHAR(100),
        target TEXT,
        quantity INTEGER,
        price BIGINT DEFAULT 0,
        cost_price BIGINT DEFAULT 0,
        sell_price BIGINT DEFAULT 0,
        profit BIGINT DEFAULT 0,
        status VARCHAR(30) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        refill_id VARCHAR(50),
        status VARCHAR(30),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS category_margins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name VARCHAR(100) UNIQUE,
        margin_type VARCHAR(20) DEFAULT 'percent',
        margin_value INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT
      );
      
      CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id BIGINT NOT NULL,
        reference_id VARCHAR(100) NOT NULL UNIQUE,
        amount DECIMAL(15,2) NOT NULL,
        fee DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Pending',
        payment_method VARCHAR(50),
        pay_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME NULL
      );

      CREATE TABLE IF NOT EXISTS banks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_name VARCHAR(100) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        account_name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        user_id BIGINT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id BIGINT NOT NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default settings exist
    await db.run('INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)', ['markup_percent', '20']);

    logger.info('SQLite Tables initialized.');
    return db;
  } catch (err) {
    logger.error('Database Init Error', err);
    throw err;
  }
}

class DatabaseParams {
  constructor() {
    this.db = db;
  }
  
  async query(sql, params = []) {
    if (!db) return [[], []];
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('ALTER') || upper.startsWith('CREATE')) {
      const result = await db.run(sql, params);
      return [{ insertId: result.lastID, affectedRows: result.changes }, []];
    } else {
      const rows = await db.all(sql, params);
      return [rows, []];
    }
  }
  
  async execute(sql, params = []) {
    if (!db) return [[], []]; 
    const result = await db.run(sql, params);
    // return structure compatible with MySQL execute for insert
    return [{ insertId: result.lastID, affectedRows: result.changes }, []];
  }
  
  async get(sql, params = []) {
    if (!db) return null;
    return await db.get(sql, params);
  }
}

const dbInstance = new DatabaseParams();

dbInstance.init = async () => {
    await initDatabase();
}

module.exports = dbInstance;
