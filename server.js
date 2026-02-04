const express = require("express");
const bodyParser = require("body-parser"); // تقدر تشيله لو هتستخدم express.json/urlencoded
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

// لو على Railway/أي Reverse Proxy (HTTPS termination)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // مهم عشان req.secure و X-Forwarded-Proto :contentReference[oaicite:3]{index=3}
}

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://king-store-esport.vercel.app",
    ],
    credentials: true,
  })
);

// ممكن تستبدل body-parser بـ express.json/urlencoded (Express >= 4.16)
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

// =======================
// 3) Session
// =======================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default-secret-key",
    resave: false,
    saveUninitialized: false, // أفضل من true (يقلل جلسات بدون داعي)
    proxy: process.env.NODE_ENV === "production", // يساعد في بيئات Proxy
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      // في الإنتاج غالبًا Frontend/Backend على دومين مختلف => تحتاج SameSite=None + Secure
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production", // HTTPS only
      // بديل ممكن: secure: 'auto' مع trust proxy مضبوط :contentReference[oaicite:4]{index=4}
    },
  })
);

// =======================
// 4) Uploads (خارج public) + Multer limits + fileFilter
// =======================
const UPLOAD_DIR = path.join(__dirname, "uploads");

// إنشاء مجلد uploads إذا لم يكن موجوداً
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

// فلترة + limits (للحماية من DoS وتحديد نوع الملفات) :contentReference[oaicite:5]{index=5}
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Invalid file type. Only images are allowed."));
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
// 6) Email (Gmail)
// =======================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// مهم: Gmail عادة يحتاج OAuth2 أو App Password لأن Less Secure Apps اتقفلت :contentReference[oaicite:6]{index=6}

// =======================
// 7) HTML Pages
// =======================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session.admin) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// =======================
// Helper: Admin auth middleware
// =======================
function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(403).json({ success: false, message: "غير مصرح" });
  next();
}

// =======================
// 8) API Routes
// =======================
app.post("/api/order", upload.single("screenshot"), (req, res) => {
  const { name, playerId, email, ucAmount, bundle, totalAmount, transactionId } = req.body;

  if (!name || !playerId || !email || !transactionId || !totalAmount || (!ucAmount && !bundle)) {
    return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
  }

  const type = ucAmount ? "UC" : "Bundle";
  // نخزن اسم الملف فقط (مش public url)
  const screenshot = req.file ? req.file.filename : null;

  db.run(
    `INSERT INTO orders (name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId, screenshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId, screenshot],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحفظ" });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post("/api/inquiry", async (req, res) => {
  const { email, message } = req.body;

  if (!email || !message) {
    return res.status(400).json({ success: false, message: "البريد والرسالة مطلوبان" });
  }

  try {
    db.run("INSERT INTO inquiries (email, message) VALUES (?, ?)", [email, message], async function (err) {
      if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

      // ملاحظة: الأفضل تعمل escape/sanitize للـ message لو هتبعته كـ HTML
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
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "فشل إرسال البريد الإلكتروني" });
  }
});

app.post("/api/suggestion", async (req, res) => {
  const { name, contact, message } = req.body;

  if (!name || !contact || !message) {
    return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
  }

  try {
    db.run(
      "INSERT INTO suggestions (name, contact, message) VALUES (?, ?, ?)",
      [name, contact, message],
      async function (err) {
        if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

        await transporter.sendMail({
          from: `"اقتراح جديد" <${process.env.SMTP_USER}>`,
          to: process.env.SMTP_USER,
          subject: "اقتراح جديد للموقع",
          html: `
            <div dir="rtl">
              <h2 style="color: #ffa726;">اقتراح جديد</h2>
              <p><strong>الاسم:</strong> ${name}</p>
              <p><strong>طريقة التواصل:</strong> ${contact}</p>
              <p><strong>الاقتراح:</strong></p>
              <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #ffa726;">${message}</p>
            </div>
          `,
        });

        res.json({ success: true });
      }
    );
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الاقتراح" });
  }
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
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    }
    res.json({ success: true, data: rows });
  });
});

app.get("/api/admin/inquiries", requireAdmin, (req, res) => {
  db.all("SELECT * FROM inquiries ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    }
    res.json({ success: true, data: rows });
  });
});

app.get("/api/admin/suggestions", requireAdmin, (req, res) => {
  db.all("SELECT * FROM suggestions ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    }
    res.json({ success: true, data: rows });
  });
});

app.post("/api/admin/update-status", requireAdmin, (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ success: false, message: "معرّف الطلب والحالة مطلوبان" });

  db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "حدث خطأ أثناء التحديث" });
    }
    res.json({ success: true });
  });
});

// DELETE أفضل بـ params بدل body
app.delete("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM orders WHERE id = ?", [id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    }
    res.json({ success: true });
  });
});

app.delete("/api/admin/inquiries/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM inquiries WHERE id = ?", [id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    }
    res.json({ success: true });
  });
});

app.delete("/api/admin/suggestions/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM suggestions WHERE id = ?", [id], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "حدث خطأ أثناء الحذف" });
    }
    res.json({ success: true });
  });
});

// Route محمي لعرض screenshot (بدل public/uploads)
app.get("/api/admin/orders/:id/screenshot", requireAdmin, (req, res) => {
  const { id } = req.params;

  db.get("SELECT screenshot FROM orders WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });
    }
    if (!row || !row.screenshot) {
      return res.status(404).json({ success: false, message: "لا يوجد صورة" });
    }

    const filePath = path.join(UPLOAD_DIR, row.screenshot);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "الملف غير موجود" });
    }

    // إرسال الملف (Express يحدد Content-Type غالبًا من الامتداد)
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
      `,
    });

    db.run("UPDATE inquiries SET status = 'تم الرد' WHERE id = ?", [inquiryId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending reply:", error);
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
      from: `"فريق الدعم" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffa726;">${subject}</h2>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; border-right: 3px solid #2196F3;">
            ${String(message).replace(/\n/g, "<br>")}
          </div>
          <hr>
          <p style="text-align: center; color: #777;">مع تحيات فريق الدعم</p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الرسالة" });
  }
});

// =======================
// 10) Start server
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
