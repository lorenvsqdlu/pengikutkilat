-- PostgreSQL Schema Migration

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    username VARCHAR(100),
    fullname VARCHAR(255),
    balance BIGINT DEFAULT 0,
    lock_until TIMESTAMP NULL,
    is_banned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    service_id INTEGER,
    service_name VARCHAR(255),
    api_order_id VARCHAR(50),
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP NULL
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
    amount DECIMAL(15,2) NOT NULL,
    reason TEXT,
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
