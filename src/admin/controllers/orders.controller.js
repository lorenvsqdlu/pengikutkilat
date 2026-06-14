const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
    try {
        const orders = await prisma.orders.findMany({
            orderBy: { created_at: 'desc' },
            include: { users: true }
        });
        res.render('orders', { title: 'Manajemen Order', orders });
    } catch(err) {
        res.status(500).send("Error loading orders");
    }
};
