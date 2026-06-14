const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
  try {
    const users = await prisma.users.findMany({
      orderBy: { created_at: 'desc' }
    });
    res.render('users', { title: 'Daftar User', users });
  } catch (err) {
    res.status(500).send("Error loading users");
  }
};

exports.updateBalance = async (req, res) => {
  const userId = parseInt(req.params.id);
  const action = req.body.action; // 'add' or 'sub'
  const amount = parseFloat(req.body.amount);

  try {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (user) {
       let newBalance = parseFloat(user.balance);
       if (action === 'add') newBalance += amount;
       if (action === 'sub') newBalance -= amount;

       await prisma.users.update({
         where: { id: userId },
         data: { balance: newBalance }
       });

       await prisma.admin_logs.create({
         data: {
           admin_id: req.admin.id,
           action: action === 'add' ? 'Tambahkan Saldo' : 'Kurangi Saldo',
           details: `User ${user.telegram_id} by ${amount}`
         }
       });
    }
    res.redirect('/admin/users');
  } catch (err) {
    res.status(500).send("Error updating balance");
  }
};

exports.toggleBan = async (req, res) => {
  const userId = parseInt(req.params.id);
  const is_banned = req.body.is_banned === 'true';

  try {
     const user = await prisma.users.update({
        where: { id: userId },
        data: { is_banned }
     });

     await prisma.admin_logs.create({
        data: {
           admin_id: req.admin.id,
           action: is_banned ? 'Ban User' : 'Unban User',
           details: `User ID ${user.telegram_id}`
        }
     });
     res.redirect('/admin/users');
  } catch(err) {
     res.status(500).send("Error updating ban status");
  }
};
