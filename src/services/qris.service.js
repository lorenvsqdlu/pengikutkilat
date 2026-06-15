const db = require('../database');

class QrisService {
    static async getActiveQris() {
        const [rows] = await db.query('SELECT * FROM qris_accounts WHERE is_active = TRUE');
        return rows || [];
    }
}

module.exports = QrisService;
