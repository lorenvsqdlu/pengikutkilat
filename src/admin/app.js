const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
// const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth.routes');
const authMiddleware = require('./middlewares/auth.middleware');

const app = express();

// Security (disabled helmet temporarily to allow CDNs easily if needed, or configure appropriately)
// app.use(helmet()); 
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    message: "Too many requests from this IP, please try again later."
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(methodOverride('_method'));

// View Engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout'); // default layout

// Routes
app.use('/auth', authRoutes);
app.use('/', authMiddleware, adminRoutes);

module.exports = app;
