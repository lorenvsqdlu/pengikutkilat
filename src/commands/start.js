const StartController = require('../controllers/start.controller');

module.exports = (bot) => {
  // Register the /start command to the StartController
  bot.start(StartController.handleStart);
};
