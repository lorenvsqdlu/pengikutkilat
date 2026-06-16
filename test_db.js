require('dotenv').config();
const db = require('./src/database');
async function test() {
    await db.init();
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('welcome_message', 'TEST1') ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value");
    const [rows] = await db.query("SELECT * FROM settings WHERE setting_key = 'welcome_message'");
    console.log(rows);
}
test().catch(console.error).then(()=>process.exit(0));
