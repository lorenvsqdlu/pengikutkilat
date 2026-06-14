const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const config = require('../../config');

exports.loginPage = async (req, res) => {
  // If no admin exists, create a default one
  const count = await prisma.admins.count();
  if (count === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.admins.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        role: 'superadmin'
      }
    });
  }
  
  if (req.cookies && req.cookies.admin_token) {
     return res.redirect('/admin');
  }

  res.render('login', { layout: false, error: null });
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const admin = await prisma.admins.findUnique({ where: { username } });
    if (!admin) {
      return res.render('login', { layout: false, error: 'Invalid username or password' });
    }

    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      return res.render('login', { layout: false, error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role }, 
      config.JWT_SECRET, 
      { expiresIn: '1d' }
    );

    res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    
    // Log Admin Login
    await prisma.admin_logs.create({
      data: {
        admin_id: admin.id,
        action: 'Login Admin',
        details: 'Admin logged in via web.'
      }
    });

    res.redirect('/admin');

  } catch (error) {
    console.error(error);
    res.render('login', { layout: false, error: 'System error.' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/auth/login');
};
