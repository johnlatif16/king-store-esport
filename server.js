require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// تهيئة قاعدة البيانات
const DB_FILE = path.join(__dirname, 'database.json');
let db = { orders: [], inquiries: [], admin: { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS } };

// تحميل قاعدة البيانات إذا كانت موجودة
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// حفظ قاعدة البيانات
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// إعداد الجلسة
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(bodyParser.json());
app.use(cors({
  origin: true,
  credentials: true
}));

// Middleware للتحقق من صحة الإدارة
function adminAuth(req, res, next) {
  if (req.session.admin) {
    next();
  } else {
    res.status(403).json({ success: false, message: "غير مصرح بالوصول" });
  }
}

// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// API Endpoints

// تسجيل الدخول للإدارة
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === db.admin.username && password === db.admin.password) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
  }
});

// تسجيل الخروج
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// الحصول على جميع الطلبات (للإدارة)
app.get('/api/admin/orders', adminAuth, (req, res) => {
  res.json(db.orders);
});

// الحصول على جميع الاستفسارات (للإدارة)
app.get('/api/admin/inquiries', adminAuth, (req, res) => {
  res.json(db.inquiries);
});

// تحديث حالة الطلب
app.post('/api/admin/update-status', adminAuth, (req, res) => {
  const { id, status } = req.body;
  const order = db.orders.find(o => o.id === id);
  
  if (order) {
    order.status = status;
    saveDB();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: "الطلب غير موجود" });
  }
});

// حذف طلب
app.delete('/api/admin/delete-order', adminAuth, (req, res) => {
  const { id } = req.body;
  db.orders = db.orders.filter(o => o.id !== id);
  saveDB();
  res.json({ success: true });
});

// حذف استفسار
app.delete('/api/admin/delete-inquiry', adminAuth, (req, res) => {
  const { id } = req.body;
  db.inquiries = db.inquiries.filter(i => i.id !== id);
  saveDB();
  res.json({ success: true });
});

// إضافة طلب جديد
app.post('/api/order', (req, res) => {
  const order = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    status: "قيد المراجعة",
    ...req.body
  };
  
  db.orders.push(order);
  saveDB();
  
  // إرسال إشعار بالبريد الإلكتروني
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: order.email,
    subject: 'تم استلام طلبك في STORE King',
    text: `مرحباً ${order.name},\n\nشكراً لتقديم طلبك. سوف نقوم بمراجعة طلبك والتحويل المالي وسيتم إعلامك عند اكتمال العملية.\n\nتفاصيل الطلب:\nID اللاعب: ${order.playerId}\nالمبلغ: ${order.totalAmount} جنيه\n\nمع تحيات,\nفريق STORE King`
  };
  
  transporter.sendMail(mailOptions, (error) => {
    if (error) console.error('Error sending email:', error);
  });
  
  res.json({ success: true });
});

// إضافة استفسار جديد
app.post('/api/inquiry', (req, res) => {
  const inquiry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    ...req.body
  };
  
  db.inquiries.push(inquiry);
  saveDB();
  
  // إرسال إشعار بالبريد الإلكتروني
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: inquiry.email,
    subject: 'تم استلام استفسارك في STORE King',
    text: `مرحباً,\n\nشكراً لتواصلك معنا. لقد تلقينا استفسارك وسيتم الرد عليك في أقرب وقت ممكن.\n\nرسالتك:\n${inquiry.message}\n\nمع تحيات,\nفريق STORE King`
  };
  
  transporter.sendMail(mailOptions, (error) => {
    if (error) console.error('Error sending email:', error);
  });
  
  res.json({ success: true });
});

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});