const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");
require('dotenv').config();

const app = express();

// إعداد قاعدة البيانات مع تعامل مع الأخطاء
const db = new sqlite3.Database("./data.db", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1);
  }
  console.log("Connected to SQLite database");
});

// إعدادات الميدل وير
app.use(cors({ 
  origin: true,
  credentials: true 
}));
app.use(bodyParser.json());

// تحديد المسار الصحيح للملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// إعداد الجلسة
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
  }
}));

// إنشاء الجداول
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    playerId TEXT,
    email TEXT,
    type TEXT,
    ucAmount TEXT,
    bundle TEXT,
    totalAmount TEXT,
    transactionId TEXT,
    status TEXT DEFAULT 'لم يتم الدفع'
  )`, (err) => {
    if (err) console.error("Error creating orders table:", err);
  });

  db.run(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Error creating inquiries table:", err);
  });
});

// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Routes لخدمة صفحات HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get("/dashboard", (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API Routes
app.post("/api/order", (req, res) => {
  const { name, playerId, email, ucAmount, bundle, totalAmount, transactionId } = req.body;
  const type = ucAmount ? "UC" : "Bundle";
  
  db.run(
    `INSERT INTO orders (name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "حدث خطأ أثناء الحفظ" });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post("/api/inquiry", async (req, res) => {
  const { email, message } = req.body;
  
  try {
    db.run(
      "INSERT INTO inquiries (email, message) VALUES (?, ?)",
      [email, message],
      async function(err) {
        if (err) throw err;
        
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.SMTP_USER,
          subject: "استفسار جديد من العميل",
          html: `<p><strong>البريد:</strong> ${email}</p><p><strong>الرسالة:</strong> ${message}</p>`,
        });
        
        res.json({ success: true });
      }
    );
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "فشل إرسال البريد الإلكتروني" });
  }
});

// Admin Routes
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === "john" && password === "latif") {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

app.get("/api/admin/orders", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  
  db.all("SELECT * FROM orders ORDER BY id DESC", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "خطأ في قاعدة البيانات" });
    }
    res.json(rows);
  });
});

app.get("/api/admin/inquiries", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  
  db.all("SELECT * FROM inquiries ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "خطأ في قاعدة البيانات" });
    }
    res.json(rows);
  });
});

app.post("/api/admin/update-status", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  
  const { id, status } = req.body;
  db.run(
    "UPDATE orders SET status = ? WHERE id = ?",
    [status, id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "حدث خطأ أثناء التحديث" });
      }
      res.json({ success: true });
    }
  );
});

app.delete("/api/admin/delete-order", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  
  const { id } = req.body;
  db.run("DELETE FROM orders WHERE id = ?", [id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
    }
    res.json({ success: true });
  });
});

app.delete("/api/admin/delete-inquiry", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });
  
  const { id } = req.body;
  db.run("DELETE FROM inquiries WHERE id = ?", [id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
    }
    res.json({ success: true });
  });
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});