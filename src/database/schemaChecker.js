const db = require('../database');
const logger = require('../utils/logger');

const checkAndMigrate = async () => {
    logger.info('[SCHEMA CHECK] Starting database schema validation...');

    // We can define expected columns and their types
    const expectedSchema = {
        users: {
            lock_until: 'TIMESTAMP',
            admin_login_attempts: 'INTEGER',
            admin_lock_until: 'TIMESTAMP'
        },
        orders: {
            api_order_id: 'VARCHAR(50)',
            external_id: 'VARCHAR(100)',
            cost_price: 'BIGINT',
            sell_price: 'BIGINT',
            profit: 'BIGINT',
            refund_processed: 'BOOLEAN',
            updated_at: 'TIMESTAMP'
        },
        orders_queue: {
            retry_count: 'INTEGER',
            smm_payload: 'TEXT',
            updated_at: 'TIMESTAMP',
            created_at: 'TIMESTAMP'
        },
        deposits: {
            reference_id: 'VARCHAR(100)'
        },
        category_margins: {
            margin_type: 'VARCHAR(20)',
            margin_value: 'INTEGER'
        },
        balance_mutations: {
            type: 'VARCHAR(50)',
            amount: 'BIGINT',
            balance_before: 'BIGINT',
            balance_after: 'BIGINT'
        },
        user_sessions: {
            updated_at: 'TIMESTAMP',
            created_at: 'TIMESTAMP'
        }
    };

    try {
        for (const [table, columns] of Object.entries(expectedSchema)) {
            // check if table exists
            const [tableRes] = await db.query(`SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public'
                AND table_name = $1
            )`, [table]);
            
            if (tableRes && tableRes.length > 0 && tableRes[0].exists) {
                // Table exists
                for (const [colName, colType] of Object.entries(columns)) {
                    const [colRes] = await db.query(`SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name=$1 AND column_name=$2`, [table, colName]);
                        
                    if (!colRes || colRes.length === 0) {
                        logger.warn(`[SCHEMA CHECK] ${table}.${colName} : MISSING. Adding column...`);
                        try {
                            await db.pool.query(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType}`);
                            logger.info(`[SCHEMA CHECK] Successfully added ${colName} to ${table}`);
                        } catch (e) {
                            if (!e.message.includes('ECONNREFUSED')) {
                                logger.error(`[SCHEMA CHECK] Failed to add ${colName} to ${table}: ${e.message}`);
                            }
                        }
                    } else {
                        logger.info(`[SCHEMA CHECK] ${table}.${colName} : OK`);
                    }
                }
            } else {
                logger.warn(`[SCHEMA CHECK] Table ${table} : MISSING (It might be created after validation)`);
            }
        }
        logger.info('[SCHEMA CHECK] Schema validation completed.');
    } catch (e) {
        if (!e.message.includes('ECONNREFUSED')) {
            logger.error(`[SCHEMA CHECK] General schema validation error: ${e.message}`);
        } else {
            logger.warn('[SCHEMA CHECK] Skipping checking due to ECONNREFUSED.');
        }
    }
};

module.exports = checkAndMigrate;
