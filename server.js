require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Fake Database (Replace with a real database like MongoDB)
let orders = [];
let inquiries = [];

// Email Transporter
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Serve HTML Files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API Routes

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// Create New Order
app.post('/api/order', (req, res) => {
  const order = req.body;
  order.id = Date.now();
  order.status = 'لم يتم الدفع';
  order.createdAt = new Date();
  orders.push(order);
  
  // Send email notification
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: process.env.SMTP_USER,
    subject: 'New Order Received',
    text: `New order from ${order.name} (${order.email}) for ${order.ucAmount || order.bundle}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Email error:', error);
    }
  });

  res.json({ success: true, order });
});

// Get All Orders (Admin)
app.get('/api/admin/orders', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  res.json(orders);
});

// Update Order Status
app.post('/api/admin/update-status', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { id, status } = req.body;
  const orderIndex = orders.findIndex(o => o.id == id);

  if (orderIndex !== -1) {
    orders[orderIndex].status = status;
    return res.json({ success: true });
  }

  return res.status(404).json({ success: false });
});

// Delete Order
app.delete('/api/admin/delete-order', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.body;
  orders = orders.filter(o => o.id != id);
  res.json({ success: true });
});

// Create Inquiry
app.post('/api/inquiry', (req, res) => {
  const inquiry = req.body;
  inquiry.id = Date.now();
  inquiry.createdAt = new Date();
  inquiries.push(inquiry);

  // Send email notification
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: process.env.SMTP_USER,
    subject: 'New Inquiry Received',
    text: `New inquiry from ${inquiry.email}:\n${inquiry.message}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Email error:', error);
    }
  });

  res.json({ success: true });
});

// Get All Inquiries (Admin)
app.get('/api/admin/inquiries', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  res.json(inquiries);
});

// Delete Inquiry
app.delete('/api/admin/delete-inquiry', (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.body;
  inquiries = inquiries.filter(i => i.id != id);
  res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});