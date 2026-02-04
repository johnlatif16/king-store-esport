// server.js
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
require("dotenv").config();

const app = express();

// =======================
// 0) Trust proxy (Railway/Reverse Proxy)
// =======================
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// =======================
// 1) DB
// =======================
const db = new sqlite3.Database(
  "./data.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error("Error opening database:", err.message);
      process.exit(1);
    }
    console.log("Connected to SQLite database");
  }
);

// =======================
// 2) Middlewares
// =======================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (مهم مع credentials)
const allowedOrigins = [
  "https://trip-store-esport.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: function (origin, cb) {
      // Requests from tools like curl/postman may have no origin
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

// =======================
// 3) Session
// =======================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default-secret-key",
    resave: false,
    saveUninitialized: false,
    proxy: process.env.NODE_ENV === "production",
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// =======================
// 4) Uploads (PRIVATE folder)
// =======================
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Invalid file type. Only jpeg/png/webp allowed."));
    }
    cb(null, true);
  },
});

// =======================
// 5) Tables
// =======================
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
    screenshot TEXT,
    status TEXT DEFAULT 'لم يتم الدفع'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT,
    status TEXT DEFAULT 'قيد الانتظار',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    contact TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// =======================
// 6) Email
// =======================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// =======================
// 7) Helpers
// =======================
function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(403).json({ success: false, message: "غير مصرح" });
  next();
}

// Simple health endpoint (مهم للتجربة)
app.get("/api/health", (req, res) => res.json({ ok: true }));

// =======================
// 8) API Routes
// =======================

// ORDER (multipart/form-data) with screenshot
app.post("/api/order", upload.single("screenshot"), (req, res) => {
  const { name, playerId, email, ucAmount, bundle, totalAmount, transactionId } = req.body;

  if (!name || !playerId || !email || !totalAmount || !transactionId || (!ucAmount && !bundle)) {
    return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة + اختيار شدات/حزمة + رقم التحويل + سكرين شوت" });
  }

  const type = ucAmount ? "UC" : "Bundle";
  const screenshot = req.file ? req.file.filename : null;

  if (!screenshot) {
    return res.status(400).json({ success: false, message: "السكرين شوت مطلوب" });
  }

  db.run(
    `INSERT INTO orders (name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId, screenshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, playerId, email, type, ucAmount || "", bundle || "", totalAmount, transactionId, screenshot],
    function (err) {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحفظ" });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Inquiry (JSON)
app.post("/api/inquiry", (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: "الاسم + البريد + الرسالة مطلوبين" });
  }

  db.run(
    "INSERT INTO inquiries (name, email, message) VALUES (?, ?, ?)",
    [name, email, message],
    async function (err) {
      if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

      try {
        await transporter.sendMail({
          from: `"Trip STORE Support" <${process.env.SMTP_USER}>`,
          to: process.env.SMTP_USER,
          subject: "استفسار جديد",
          html: `
            <div dir="rtl">
              <h2>استفسار جديد</h2>
              <p><strong>الاسم:</strong> ${name}</p>
              <p><strong>البريد:</strong> ${email}</p>
              <p><strong>الرسالة:</strong></p>
              <div style="background:#f5f5f5;padding:10px;border-right:3px solid #ffa726;">${String(message)}</div>
            </div>
          `,
        });
      } catch (e) {
        console.error("Mail error:", e);
      }

      res.json({ success: true });
    }
  );
});

// Suggestion (JSON)
app.post("/api/suggestion", (req, res) => {
  const { name, contact, message } = req.body;

  if (!name || !contact || !message) {
    return res.status(400).json({ success: false, message: "الاسم + وسيلة التواصل + الرسالة مطلوبين" });
  }

  db.run(
    "INSERT INTO suggestions (name, contact, message) VALUES (?, ?, ?)",
    [name, contact, message],
    async function (err) {
      if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

      try {
        await transporter.sendMail({
          from: `"Trip STORE Suggestion" <${process.env.SMTP_USER}>`,
          to: process.env.SMTP_USER,
          subject: "اقتراح جديد",
          html: `
            <div dir="rtl">
              <h2>اقتراح جديد</h2>
              <p><strong>الاسم:</strong> ${name}</p>
              <p><strong>التواصل:</strong> ${contact}</p>
              <p><strong>الاقتراح:</strong></p>
              <div style="background:#f5f5f5;padding:10px;border-right:3px solid #25D366;">${String(message)}</div>
            </div>
          `,
        });
      } catch (e) {
        console.error("Mail error:", e);
      }

      res.json({ success: true });
    }
  );
});

// =======================
// 9) Admin Routes
// =======================
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

    const data = rows.map((r) => ({
      ...r,
      screenshotUrl: r.screenshot ? `/api/admin/orders/${r.id}/screenshot` : null,
    }));

    res.json({ success: true, data });
  });
});

app.get("/api/admin/inquiries", requireAdmin, (req, res) => {
  db.all("SELECT * FROM inquiries ORDER BY created_at DESC", (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    res.json({ success: true, data: rows });
  });
});

app.get("/api/admin/suggestions", requireAdmin, (req, res) => {
  db.all("SELECT * FROM suggestions ORDER BY created_at DESC", (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    res.json({ success: true, data: rows });
  });
});

app.post("/api/admin/update-status", requireAdmin, (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ success: false, message: "معرّف الطلب والحالة مطلوبان" });

  db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id], function (err) {
    if (err) return res.status(500).json({ success: false, message: "حدث خطأ أثناء التحديث" });
    res.json({ success: true });
  });
});

// New delete endpoints (REST)
app.delete("/api/admin/orders/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM orders WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    res.json({ success: true });
  });
});

app.delete("/api/admin/inquiries/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM inquiries WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    res.json({ success: true });
  });
});

app.delete("/api/admin/suggestions/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM suggestions WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    res.json({ success: true });
  });
});

// Protected screenshot
app.get("/api/admin/orders/:id/screenshot", requireAdmin, (req, res) => {
  db.get("SELECT screenshot FROM orders WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    if (!row || !row.screenshot) return res.status(404).json({ success: false, message: "لا يوجد صورة" });

    const filePath = path.join(UPLOAD_DIR, row.screenshot);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "الملف غير موجود" });

    res.sendFile(filePath);
  });
});

app.post("/api/admin/reply-inquiry", requireAdmin, async (req, res) => {
  const { inquiryId, email, message, reply } = req.body;
  if (!inquiryId || !email || !message || !reply) {
    return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
  }

  try {
    await transporter.sendMail({
      from: `"Trip STORE Support" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "رد على استفسارك",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffa726;">شكراً لتواصلك معنا</h2>
          <p><strong>استفسارك:</strong></p>
          <div style="background:#f5f5f5;padding:10px;border-right:3px solid #ffa726;">${String(message)}</div>
          <h3 style="color: #2196F3;">رد الفريق:</h3>
          <div style="background:#f5f5f5;padding:10px;border-right:3px solid #2196F3;">${String(reply)}</div>
        </div>
      `,
    });

    db.run("UPDATE inquiries SET status = 'تم الرد' WHERE id = ?", [inquiryId]);
    res.json({ success: true });
  } catch (e) {
    console.error("Reply mail error:", e);
    res.status(500).json({ success: false, message: "فشل إرسال الرد" });
  }
});

app.post("/api/admin/send-message", requireAdmin, async (req, res) => {
  const { email, subject, message } = req.body;
  if (!email || !subject || !message) {
    return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
  }

  try {
    await transporter.sendMail({
      from: `"Trip STORE Support" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffa726;">${String(subject)}</h2>
          <div style="background:#f5f5f5;padding:15px;border-right:3px solid #2196F3;">
            ${String(message).replace(/\n/g, "<br>")}
          </div>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("Send message error:", e);
    res.status(500).json({ success: false, message: "فشل إرسال الرسالة" });
  }
});

// =======================
// 10) Error handler (IMPORTANT)
// =======================
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ success: false, message: err.message || "Server error" });
});

// =======================
// 11) Start
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
