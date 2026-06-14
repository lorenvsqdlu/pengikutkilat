const UserController = require('../controllers/user.controller');
const RefillController = require('../controllers/refill.controller');

module.exports = (bot) => {
  // Mendaftarkan perintah /profile dan /saldo
  bot.command('profile', UserController.handleProfile);
  bot.command('saldo', UserController.handleSaldo);
  bot.command('services', UserController.handleServices);
  bot.command('refill', RefillController.handleRefill);
};
