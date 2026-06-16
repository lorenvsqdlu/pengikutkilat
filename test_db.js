const pool = require('./src/config/database');
async function test() {
  try {
    const res = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';");
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
