const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require('multer');
const fs = require('fs');
const fetch = require('node-fetch'); // إضافة مكتبة node-fetch لإشعارات Telegram
require('dotenv').config();

const app = express();

// إعداد قاعدة البيانات
const db = new sqlite3.Database("./data.db", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1); // إنهاء العملية إذا فشل الاتصال بقاعدة البيانات
  }
  console.log("Connected to SQLite database");
});

// إعدادات الميدل وير
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://king-store-esport-production.up.railway.app'],
  credentials: true 
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // لخدمة الملفات الثابتة مثل HTML, CSS, JS, والصور المرفوعة

// إعداد الجلسة
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-key-for-session', // استخدم مفتاح سري قوي من .env
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // استخدم secure: true في الإنتاج (HTTPS)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // صلاحية الجلسة ليوم واحد
    sameSite: 'lax' // حماية CSRF
  }
}));

// إنشاء مجلد uploads إذا لم يكن موجوداً
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`Created uploads directory at: ${UPLOADS_DIR}`);
}

// إعداد multer لرفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // توليد اسم ملف فريد لتجنب التعارضات
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

// فلتر لملفات الصور فقط
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // حد أقصى لحجم الملف 5MB
  fileFilter: fileFilter
});

// إنشاء الجداول في قاعدة البيانات
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    playerId TEXT NOT NULL,
    email TEXT NOT NULL,
    type TEXT NOT NULL, -- 'UC' or 'Bundle'
    ucAmount TEXT,
    bundle TEXT,
    totalAmount TEXT NOT NULL,
    transactionId TEXT NOT NULL,
    screenshot TEXT, -- مسار الصورة المرفوعة
    status TEXT DEFAULT 'لم يتم الدفع', -- 'لم يتم الدفع', 'تم الدفع'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Error creating orders table:", err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'قيد الانتظار', -- 'قيد الانتظار', 'تم الرد'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Error creating inquiries table:", err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Error creating suggestions table:", err.message);
  });

  // إضافة جدول للمستخدمين الإداريين (للتسجيل لمرة واحدة)
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL -- في تطبيق حقيقي، يجب تخزين كلمات المرور مجزأة (hashed)
  )`, (err) => {
    if (err) console.error("Error creating admins table:", err.message);
    // يمكنك إضافة مستخدم إداري افتراضي هنا إذا لم يكن موجودًا
    // db.get("SELECT COUNT(*) AS count FROM admins", (err, row) => {
    //   if (err) {
    //     console.error("Error checking admins table:", err.message);
    //     return;
    //   }
    //   if (row.count === 0) {
    //     // قم بتغيير 'admin_user' و 'admin_pass' إلى قيم آمنة
    //     db.run("INSERT INTO admins (username, password) VALUES (?, ?)", [process.env.ADMIN_USER, process.env.ADMIN_PASS], (err) => {
    //       if (err) console.error("Error inserting default admin:", err.message);
    //       else console.log("Default admin user created.");
    //     });
    //   }
    // });
  });
});

// إعداد البريد الإلكتروني (Nodemailer)
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || 'gmail', // استخدام SMTP_SERVICE من .env
  auth: {
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASS, 
  },
});

// دالة لإرسال إشعار Telegram
async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn("Telegram bot token or chat ID is not set. Skipping Telegram notification.");
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML' // للسماح بتنسيق HTML في الرسالة
      })
    });
    const data = await response.json();
    if (!data.ok) {
      console.error("Failed to send Telegram message:", data.description);
    } else {
      console.log("Telegram notification sent successfully.");
    }
  } catch (error) {
    console.error("Error sending Telegram notification:", error);
  }
}


// Middleware للتحقق من صلاحيات المسؤول
const isAuthenticatedAdmin = (req, res, next) => {
  if (req.session.admin) {
    next(); // المستخدم مسؤول، تابع للطلب
  } else {
    res.redirect('/login'); // إعادة توجيه إلى صفحة تسجيل الدخول إذا لم يكن مسؤولاً
  }
};

// --------------------------------------------------------------------
// Routes لخدمة صفحات HTML
// --------------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get("/dashboard", isAuthenticatedAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get("/pay.html", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pay.html'));
});

// --------------------------------------------------------------------
// API Routes للواجهة الأمامية (العملاء)
// --------------------------------------------------------------------

// معالجة طلبات الشراء (الشدات/الحزم)
app.post("/api/order", upload.single('screenshot'), (req, res) => {
  const { name, playerId, email, ucAmount, bundle, totalAmount, transactionId } = req.body;
  
  // التحقق من وجود جميع الحقول المطلوبة
  if (!name || !playerId || !email || !transactionId || !totalAmount || (!ucAmount && !bundle)) {
    // حذف الملف المرفوع إذا كانت هناك حقول مفقودة
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting uploaded file:", err);
      });
    }
    return res.status(400).json({ success: false, message: "جميع الحقول المطلوبة غير مكتملة." });
  }

  // التحقق من أن أحد ucAmount أو bundle فقط موجود
  if (ucAmount && bundle) {
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Error deleting uploaded file:", err);
      });
    }
    return res.status(400).json({ success: false, message: "لا يمكن اختيار شدات وحزمة ازدهار معاً." });
  }

  const type = ucAmount ? "UC" : "Bundle";
  const screenshotPath = req.file ? `/uploads/${req.file.filename}` : null;
  
  db.run(
    `INSERT INTO orders (name, playerId, email, type, ucAmount, bundle, totalAmount, transactionId, screenshot) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, playerId, email, type, ucAmount || null, bundle || null, totalAmount, transactionId, screenshotPath],
    function(err) {
      if (err) {
        console.error("Error inserting order into database:", err.message);
        // حذف الملف المرفوع إذا فشل إدخال قاعدة البيانات
        if (req.file) {
          fs.unlink(req.file.path, (unlinkErr) => {
            if (unlinkErr) console.error("Error deleting uploaded file after DB error:", unlinkErr);
          });
        }
        return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حفظ الطلب." });
      }
      const orderId = this.lastID;

      // إرسال إشعار بالبريد الإلكتروني للمسؤول
      const notificationEmail = process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER;
      if (notificationEmail) {
        transporter.sendMail({
          from: `"متجر King Esports" <${process.env.SMTP_USER}>`,
          to: notificationEmail,
          subject: `طلب جديد #${orderId} - ${name}`,
          html: `
            <div dir="rtl" style="font-family: 'Tajawal', sans-serif;">
              <h2 style="color: #ff7a00;">طلب جديد</h2>
              <p><strong>رقم الطلب:</strong> ${orderId}</p>
              <p><strong>العميل:</strong> ${name} (${email})</p>
              <p><strong>ID اللاعب:</strong> ${playerId}</p>
              <p><strong>النوع:</strong> ${type} (${ucAmount || bundle})</p>
              <p><strong>المبلغ الإجمالي:</strong> ${totalAmount}</p>
              <p><strong>رقم التحويل:</strong> ${transactionId}</p>
              ${screenshotPath ? `<p><strong>إثبات الدفع:</strong> <a href="https://king-store-esport-production.up.railway.app${screenshotPath}">عرض الصورة</a></p>` : ''}
              <p>يرجى مراجعة الطلب في لوحة التحكم.</p>
            </div>
          `,
        }).catch(mailError => console.error("Error sending order notification email:", mailError));
      }

      // إرسال إشعار Telegram
      const telegramMessage = `<b>طلب جديد!</b>\n\n` +
                              `<b>رقم الطلب:</b> ${orderId}\n` +
                              `<b>العميل:</b> ${name}\n` +
                              `<b>ID اللاعب:</b> ${playerId}\n` +
                              `<b>النوع:</b> ${type} (${ucAmount || bundle})\n` +
                              `<b>المبلغ:</b> ${totalAmount}\n` +
                              `<b>رقم التحويل:</b> ${transactionId}\n` +
                              `${screenshotPath ? `<b>إثبات الدفع:</b> <a href="https://king-store-esport-production.up.railway.app${screenshotPath}">عرض الصورة</a>\n` : ''}` +
                              `\nيرجى مراجعة لوحة التحكم.`;
      sendTelegramNotification(telegramMessage);

      res.status(201).json({ success: true, message: "تم إرسال الطلب بنجاح.", orderId: orderId });
    }
  );
});

// جلب تفاصيل طلب معين (لصفحة pay.html)
app.get("/api/order/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  db.get("SELECT * FROM orders WHERE id = ?", [orderId], (err, row) => {
    if (err) {
      console.error("Error fetching order details:", err.message);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات." });
    }
    if (!row) {
      return res.status(404).json({ success: false, message: "الطلب غير موجود." });
    }
    res.json({ success: true, data: row });
  });
});


// معالجة الاستفسارات
app.post("/api/inquiry", async (req, res) => {
  const { email, message } = req.body;
  
  if (!email || !message) {
    return res.status(400).json({ success: false, message: "البريد الإلكتروني والرسالة مطلوبان." });
  }

  try {
    db.run(
      "INSERT INTO inquiries (email, message) VALUES (?, ?)",
      [email, message],
      async function(err) {
        if (err) {
          console.error("Error inserting inquiry into database:", err.message);
          return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حفظ الاستفسار." });
        }
        
        // إرسال إشعار بالبريد الإلكتروني للمسؤول
        const notificationEmail = process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER;
        if (notificationEmail) {
          transporter.sendMail({
            from: `"متجر King Esports" <${process.env.SMTP_USER}>`,
            to: notificationEmail, // إرسال الإشعار إلى بريد المسؤول
            subject: "استفسار جديد من العميل",
            html: `
              <div dir="rtl" style="font-family: 'Tajawal', sans-serif;">
                <h2 style="color: #ff7a00;">استفسار جديد</h2>
                <p><strong>البريد الإلكتروني:</strong> ${email}</p>
                <p><strong>الرسالة:</strong></p>
                <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #ff7a00; border-radius: 5px;">${message}</p>
                <p>يرجى الرد على هذا الاستفسار في أقرب وقت ممكن من لوحة التحكم.</p>
              </div>
            `,
          }).catch(mailError => console.error("Error sending inquiry notification email:", mailError));
        }

        // إرسال إشعار Telegram
        const telegramMessage = `<b>استفسار جديد!</b>\n\n` +
                                `<b>البريد الإلكتروني:</b> ${email}\n` +
                                `<b>الرسالة:</b> ${message}\n` +
                                `\nيرجى مراجعة لوحة التحكم.`;
        sendTelegramNotification(telegramMessage);
        
        res.status(201).json({ success: true, message: "تم إرسال استفسارك بنجاح." });
      }
    );
  } catch (error) {
    console.error("Unhandled error in inquiry API:", error);
    res.status(500).json({ success: false, message: "حدث خطأ غير متوقع." });
  }
});

// معالجة الاقتراحات
app.post("/api/suggestion", async (req, res) => {
  const { name, contact, message } = req.body;
  
  if (!name || !contact || !message) {
    return res.status(400).json({ success: false, message: "جميع حقول الاقتراح مطلوبة." });
  }

  try {
    db.run(
      "INSERT INTO suggestions (name, contact, message) VALUES (?, ?, ?)",
      [name, contact, message],
      async function(err) {
        if (err) {
          console.error("Error inserting suggestion into database:", err.message);
          return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حفظ الاقتراح." });
        }
        
        // إرسال إشعار بالبريد الإلكتروني للمسؤول
        const notificationEmail = process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER;
        if (notificationEmail) {
          transporter.sendMail({
            from: `"متجر King Esports" <${process.env.SMTP_USER}>`,
            to: notificationEmail, // إرسال الإشعار إلى بريد المسؤول
            subject: "اقتراح جديد للموقع",
            html: `
              <div dir="rtl" style="font-family: 'Tajawal', sans-serif;">
                <h2 style="color: #ff7a00;">اقتراح جديد</h2>
                <p><strong>الاسم:</strong> ${name}</p>
                <p><strong>طريقة التواصل:</strong> ${contact}</p>
                <p><strong>الاقتراح:</strong></p>
                <p style="background: #f5f5f5; padding: 10px; border-right: 3px solid #ff7a00; border-radius: 5px;">${message}</p>
              </div>
            `,
          }).catch(mailError => console.error("Error sending suggestion notification email:", mailError));
        }

        // إرسال إشعار Telegram
        const telegramMessage = `<b>اقتراح جديد!</b>\n\n` +
                                `<b>الاسم:</b> ${name}\n` +
                                `<b>التواصل:</b> ${contact}\n` +
                                `<b>الاقتراح:</b> ${message}\n` +
                                `\nيرجى مراجعة لوحة التحكم.`;
        sendTelegramNotification(telegramMessage);
        
        res.status(201).json({ success: true, message: "تم إرسال اقتراحك بنجاح." });
      }
    );
  } catch (error) {
    console.error("Unhandled error in suggestion API:", error);
    res.status(500).json({ success: false, message: "حدث خطأ غير متوقع." });
  }
});

// --------------------------------------------------------------------
// Admin Routes (تتطلب تسجيل دخول المسؤول)
// --------------------------------------------------------------------

// تسجيل دخول المسؤول
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "اسم المستخدم وكلمة المرور مطلوبان." });
  }

  // في تطبيق حقيقي، يجب التحقق من كلمة المرور المجزأة (hashed password)
  // هنا نستخدم مقارنة مباشرة لأغراض التوضيح
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true; // تعيين الجلسة للمسؤول
    return res.json({ success: true, message: "تم تسجيل الدخول بنجاح." });
  }
  res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة.' });
});

// تسجيل خروج المسؤول
app.post("/api/admin/logout", isAuthenticatedAdmin, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.status(500).json({ success: false, message: "فشل تسجيل الخروج." });
    }
    res.json({ success: true, message: "تم تسجيل الخروج بنجاح." });
  });
});

// جلب جميع الطلبات
app.get("/api/admin/orders", isAuthenticatedAdmin, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error("Error fetching orders:", err.message);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات أثناء جلب الطلبات." });
    }
    res.json({ success: true, data: rows });
  });
});

// جلب جميع الاستفسارات
app.get("/api/admin/inquiries", isAuthenticatedAdmin, (req, res) => {
  db.all("SELECT * FROM inquiries ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error("Error fetching inquiries:", err.message);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات أثناء جلب الاستفسارات." });
    }
    res.json({ success: true, data: rows });
  });
});

// جلب جميع الاقتراحات
app.get("/api/admin/suggestions", isAuthenticatedAdmin, (req, res) => {
  db.all("SELECT * FROM suggestions ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error("Error fetching suggestions:", err.message);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات أثناء جلب الاقتراحات." });
    }
    res.json({ success: true, data: rows });
  });
});

// تحديث حالة الطلب
app.post("/api/admin/update-status", isAuthenticatedAdmin, (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) {
    return res.status(400).json({ success: false, message: "معرّف الطلب والحالة مطلوبان." });
  }

  db.run(
    "UPDATE orders SET status = ? WHERE id = ?",
    [status, id],
    function(err) {
      if (err) {
        console.error("Error updating order status:", err.message);
        return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء تحديث حالة الطلب." });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: "الطلب غير موجود." });
      }
      res.json({ success: true, message: "تم تحديث حالة الطلب بنجاح." });
    }
  );
});

// حذف الطلب
app.delete("/api/admin/delete-order", isAuthenticatedAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, message: "معرّف الطلب مطلوب." });
  }

  db.get("SELECT screenshot FROM orders WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("Error fetching screenshot path for deletion:", err.message);
      return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات." });
    }
    if (row && row.screenshot) {
      const filePath = path.join(__dirname, 'public', row.screenshot);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error("Error deleting screenshot file:", unlinkErr);
      });
    }

    db.run("DELETE FROM orders WHERE id = ?", [id], function(err) {
      if (err) {
        console.error("Error deleting order:", err.message);
        return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حذف الطلب." });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: "الطلب غير موجود." });
      }
      res.json({ success: true, message: "تم حذف الطلب بنجاح." });
    });
  });
});

// حذف الاستفسار
app.delete("/api/admin/delete-inquiry", isAuthenticatedAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, message: "معرّف الاستفسار مطلوب." });
  }

  db.run("DELETE FROM inquiries WHERE id = ?", [id], function(err) {
    if (err) {
      console.error("Error deleting inquiry:", err.message);
      return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حذف الاستفسار." });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: "الاستفسار غير موجود." });
    }
    res.json({ success: true, message: "تم حذف الاستفسار بنجاح." });
  });
});

// حذف الاقتراح
app.delete("/api/admin/delete-suggestion", isAuthenticatedAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, message: "معرّف الاقتراح مطلوب." });
  }

  db.run("DELETE FROM suggestions WHERE id = ?", [id], function(err) {
    if (err) {
      console.error("Error deleting suggestion:", err.message);
      return res.status(500).json({ success: false, message: "حدث خطأ داخلي أثناء حذف الاقتراح." });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: "الاقتراح غير موجود." });
    }
    res.json({ success: true, message: "تم حذف الاقتراح بنجاح." });
  });
});

// الرد على استفسار وإرسال بريد إلكتروني للعميل
app.post("/api/admin/reply-inquiry", isAuthenticatedAdmin, async (req, res) => {
  const { inquiryId, email, message, reply } = req.body;
  if (!inquiryId || !email || !message || !reply) {
    return res.status(400).json({ success: false, message: "جميع حقول الرد مطلوبة." });
  }

  try {
    await transporter.sendMail({
      from: `"فريق دعم King Esports" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "رد على استفسارك من King Esports",
      html: `
        <div dir="rtl" style="font-family: 'Tajawal', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
          <h2 style="color: #ff7a00; text-align: center;">شكراً لتواصلك معنا</h2>
          <p style="font-size: 1.1rem;">مرحباً بك،</p>
          <p>لقد تلقينا استفسارك ويسعدنا الرد عليه:</p>
          
          <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #00b4d8; margin-bottom: 20px; border-radius: 5px;">
            <p style="font-weight: bold; color: #333;">استفسارك الأصلي:</p>
            <p style="color: #555;">${message}</p>
          </div>

          <div style="background: #e6f7ff; padding: 15px; border-left: 4px solid #2196F3; border-radius: 5px;">
            <p style="font-weight: bold; color: #333;">رد فريق الدعم:</p>
            <p style="color: #555;">${reply}</p>
          </div>
          
          <p style="margin-top: 20px;">إذا كان لديك أي أسئلة أخرى، فلا تتردد في التواصل معنا.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
          <p style="text-align: center; color: #777; font-size: 0.9rem;">مع خالص التحيات،<br>فريق دعم King Esports</p>
        </div>
      `
    }).catch(mailError => console.error("Error sending reply email:", mailError));

    db.run("UPDATE inquiries SET status = 'تم الرد' WHERE id = ?", [inquiryId], function(err) {
      if (err) {
        console.error("Error updating inquiry status after reply:", err.message);
        // لا نرجع خطأ 500 هنا لأن البريد تم إرساله بنجاح
      }
    });
    res.json({ success: true, message: "تم إرسال الرد وتحديث حالة الاستفسار بنجاح." });
  } catch (error) {
    console.error("Error sending reply email:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الرد عبر البريد الإلكتروني." });
  }
});

// إرسال رسالة مباشرة إلى عميل
app.post("/api/admin/send-message", isAuthenticatedAdmin, async (req, res) => {
  const { email, subject, message } = req.body;
  if (!email || !subject || !message) {
    return res.status(400).json({ success: false, message: "جميع حقول الرسالة مطلوبة." });
  }

  try {
    await transporter.sendMail({
      from: `"King Esports" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      html: `
        <div dir="rtl" style="font-family: 'Tajawal', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
          <h2 style="color: #ff7a00; text-align: center;">${subject}</h2>
          <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #2196F3; border-radius: 5px; margin-top: 20px;">
            <p style="color: #555; white-space: pre-wrap;">${message}</p>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
          <p style="text-align: center; color: #777; font-size: 0.9rem;">مع خالص التحيات،<br>فريق King Esports</p>
        </div>
      `
    }).catch(mailError => console.error("Error sending direct message email:", mailError));

    res.json({ success: true, message: "تم إرسال الرسالة بنجاح." });
  } catch (error) {
    console.error("Error sending direct message email:", error);
    res.status(500).json({ success: false, message: "فشل إرسال الرسالة." });
  }
});

// --------------------------------------------------------------------
// بدء تشغيل الخادم
// --------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/login`);
});

// إغلاق قاعدة البيانات عند إيقاف تشغيل التطبيق
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err.message);
    }
    console.log("Database connection closed.");
    process.exit(0);
  });
});
