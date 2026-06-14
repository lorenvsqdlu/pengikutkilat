const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '../../../uploads/qris');
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, 'qris-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file gambar (jpg, jpeg, png, webp) yang diperbolehkan!'));
  }
});

const dashboardCtrl = require('../controllers/dashboard.controller');
const usersCtrl = require('../controllers/users.controller');
const ordersCtrl = require('../controllers/orders.controller');
const depositsCtrl = require('../controllers/deposits.controller');
const settingsCtrl = require('../controllers/settings.controller');
const banksCtrl = require('../controllers/banks.controller');
const qrisCtrl = require('../controllers/qris.controller');

// Dashboard Main
router.get('/', dashboardCtrl.index);

// Users
router.get('/users', usersCtrl.index);
router.post('/users/:id/balance', usersCtrl.updateBalance);
router.post('/users/:id/ban', usersCtrl.toggleBan);

// Orders
router.get('/orders', ordersCtrl.index);

// Deposits
router.get('/deposits', depositsCtrl.index);

// Banks
router.get('/banks', banksCtrl.index);
router.post('/banks', banksCtrl.add);
router.put('/banks/:id', banksCtrl.update);
router.post('/banks/:id/toggle', banksCtrl.toggle);
router.delete('/banks/:id', banksCtrl.delete);

// QRIS
router.get('/qris', qrisCtrl.index);
router.post('/qris', upload.single('qris_image'), qrisCtrl.add);
router.put('/qris/:id', upload.single('qris_image'), qrisCtrl.update);
router.post('/qris/:id/toggle', qrisCtrl.toggle);
router.delete('/qris/:id', qrisCtrl.delete);

// Settings
router.get('/settings', settingsCtrl.index);
router.post('/settings', settingsCtrl.update);

module.exports = router;
