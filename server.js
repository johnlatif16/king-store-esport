const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");
require('dotenv').config();

const app = express();
const db = new sqlite3.Database("./data.db");

// ← مهم جدًا عند النشر على Railway أو أي Reverse Proxy
app.set("trust proxy", 1);

// إعدادات CORS للسماح بطلبات من الواجهة الأمامية
app.use(cors({
  origin: "https://store-king-esport-production.up.railway.app",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors({
  origin: "https://store-king-esport-production.up.railway.app",
  credentials: true
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// إعداد الجلسات
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// إنشاء الجداول إذا لم تكن موجودة
db.prepare(`CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  playerId TEXT,
  email TEXT,
  ucAmount TEXT,
  bundle TEXT,
  totalAmount TEXT,
  transactionId TEXT,
  status TEXT DEFAULT 'لم يتم الدفع',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// API: تقديم طلب
app.post("/api/order", (req, res) => {
  const { name, playerId, email, ucAmount, bundle, totalAmount, transactionId } = req.body;
  try {
    const stmt = db.prepare(`INSERT INTO orders 
      (name, playerId, email, ucAmount, bundle, totalAmount, transactionId) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(name, playerId, email, ucAmount, bundle, totalAmount, transactionId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "حدث خطأ أثناء الحفظ" });
  }
});

// API: إرسال استفسار
app.post("/api/inquiry", async (req, res) => {
  const { email, message } = req.body;
  try {
    db.prepare(`INSERT INTO inquiries (email, message) VALUES (?, ?)`).run(email, message);
    
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER,
      subject: "استفسار جديد من العميل",
      html: `<p><strong>البريد:</strong> ${email}</p><p><strong>الرسالة:</strong> ${message}</p>`,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("خطأ في nodemailer:", error);
    res.status(500).json({ message: "فشل إرسال البريد الإلكتروني" });
  }
});

// بيانات دخول المدير
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";

// تسجيل الدخول
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
  }
});

// تسجيل الخروج
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'فشل تسجيل الخروج' });
    }
    res.json({ success: true });
  });
});

// جلب الطلبات
app.get("/api/admin/orders", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  try {
    const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في قاعدة البيانات" });
  }
});

// جلب الاستفسارات
app.get("/api/admin/inquiries", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  try {
    const rows = db.prepare("SELECT * FROM inquiries ORDER BY created_at DESC").all();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "خطأ في قاعدة البيانات" });
  }
});

// تحديث حالة الطلب
app.post("/api/admin/update-status", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  const { id, status } = req.body;
  try {
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "حدث خطأ أثناء التحديث" });
  }
});

// حذف الطلب
app.delete("/api/admin/delete-order", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  const { id } = req.body;
  try {
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
  }
});

// حذف استفسار
app.delete("/api/admin/delete-inquiry", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  const { id } = req.body;
  try {
    db.prepare("DELETE FROM inquiries WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});