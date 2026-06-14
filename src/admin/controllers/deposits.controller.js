const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
    try {
        const deposits = await prisma.deposits.findMany({
            orderBy: { created_at: 'desc' },
            include: { users: true }
        });
        res.render('deposits', { title: 'Manajemen Deposit', deposits });
    } catch(err) {
        res.status(500).send("Error loading deposits");
    }
};
