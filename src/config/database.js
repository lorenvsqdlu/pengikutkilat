const { Pool, types } = require('pg');
require('dotenv').config();

// Parse BIGINT (int8) as integers to prevent issues
types.setTypeParser(20, (val) => parseInt(val, 10));
// Parse NUMERIC as float
types.setTypeParser(1700, (val) => parseFloat(val));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('error', (err, client) => {
  console.error('[DATABASE ERROR] Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
