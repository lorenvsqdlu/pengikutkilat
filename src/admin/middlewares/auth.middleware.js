const jwt = require('jsonwebtoken');
const config = require('../../config');

module.exports = (req, res, next) => {
  const token = req.cookies.admin_token;

  if (!token) {
    return res.redirect('/admin/auth/login');
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.clearCookie('admin_token');
    return res.redirect('/admin/auth/login');
  }
};
