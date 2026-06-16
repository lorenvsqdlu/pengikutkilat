const pool = require('./src/config/database');
async function test() {
  try {
    const res = await pool.query("SELECT id, name, platform, status FROM services WHERE LOWER(platform) LIKE '%twitter%' OR LOWER(platform) LIKE '%x%';");
    console.log(res.rows.slice(0, 5));
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
