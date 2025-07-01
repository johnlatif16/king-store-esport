const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");
require('dotenv').config();

const app = express();

// إعداد قاعدة البيانات
const db = new sqlite3.Database("./data.db", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1);
  }
  console.log("Connected to SQLite database");
});

// إعدادات الميدل وير
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000','https://store-king-esport-production-9e19.up.railway.app/'],
  credentials: true 
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// إعداد الجلسة
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
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
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    message TEXT,
    status TEXT DEFAULT 'قيد الانتظار',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  service: 'gmail',
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
          from: `"فريق الدعم" <${process.env.SMTP_USER}>`,
          to: process.env.SMTP_USER,
          subject: "استفسار جديد من العميل",
          html: `
            <div dir="rtl">
              <h2 style="color: #ffa726;">استفسار جديد</h2>
              <p><strong>البريد:</strong> ${email}</p>
              <p><strong>الرسالة:</strong></p>
              <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #ffa726;">${message}</p>
            </div>
          `,
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
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
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

app.post("/api/admin/reply-inquiry", async (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });

  const { inquiryId, email, message, reply } = req.body;
  
  try {
    await transporter.sendMail({
      from: `"فريق الدعم" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "رد على استفسارك",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffa726;">شكراً لتواصلك معنا</h2>
          <p><strong>استفسارك:</strong></p>
          <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #ffa726;">${message}</p>
          <h3 style="color: #ffa726;">رد الفريق:</h3>
          <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #2196F3;">${reply}</p>
          <hr>
          <p style="text-align: center; color: #777;">مع تحيات فريق الدعم</p>
        </div>
      `
    });

    db.run("UPDATE inquiries SET status = 'تم الرد' WHERE id = ?", [inquiryId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending reply:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الرد" });
  }
});

app.post("/api/admin/send-message", async (req, res) => {
  if (!req.session.admin) return res.status(403).json({ message: "غير مصرح" });

  const { email, subject, message } = req.body;
  
  try {
    await transporter.sendMail({
      from: `"فريق الدعم" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffa726;">${subject}</h2>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; border-right: 3px solid #2196F3;">
            ${message.replace(/\n/g, '<br>')}
          </div>
          <hr>
          <p style="text-align: center; color: #777;">مع تحيات فريق الدعم</p>
        </div>
      `
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الرسالة" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
