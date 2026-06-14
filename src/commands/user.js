const UserController = require('../controllers/user.controller');

module.exports = (bot) => {
  // Mendaftarkan perintah /profile dan /saldo
  bot.command('profile', UserController.handleProfile);
  bot.command('saldo', UserController.handleSaldo);
};
