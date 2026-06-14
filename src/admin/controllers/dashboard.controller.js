const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
  try {
    const totalUser = await prisma.users.count();
    const totalOrder = await prisma.orders.count();
    
    // Aggregate data using sum
    const depositsResult = await prisma.deposits.aggregate({
        _sum: { amount: true },
        where: { status: 'Paid' }
    });
    const totalDeposit = depositsResult._sum.amount || 0;

    const profitResult = await prisma.orders.aggregate({
        _sum: { profit: true }
    });
    const totalProfit = profitResult._sum.profit || 0;

    const refundResult = await prisma.refunds.aggregate({
        _sum: { amount: true }
    });
    const totalRefund = refundResult._sum.amount || 0;

    const userBalanceResult = await prisma.users.aggregate({
        _sum: { balance: true }
    });
    const totalSaldoUser = userBalanceResult._sum.balance || 0;

    // We can also fetch 10 last orders
    const recentOrders = await prisma.orders.findMany({
        take: 10,
        orderBy: { created_at: 'desc' }
    });

    res.render('dashboard', {
        title: 'Dashboard',
        totalUser,
        totalOrder,
        totalDeposit,
        totalProfit,
        totalRefund,
        totalSaldoUser,
        recentOrders
    });

  } catch (error) {
    console.error(error);
    res.send("Error loading dashboard");
  }
};
