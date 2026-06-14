const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class QrisService {
    static async getActiveQris() {
        return prisma.qris_accounts.findMany({
            where: { is_active: true }
        });
    }
}

module.exports = QrisService;
