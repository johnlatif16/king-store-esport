const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Middleware لتسجيل الطلبات (للتشخيص)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// تكوين multer لتحميل الملفات
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// تكوين قاعدة البيانات
const db = new sqlite3.Database('database.db');

// إنشاء الجداول إذا لم تكن موجودة
db.serialize(() => {
  // جدول الطلبات
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    playerId TEXT,
    email TEXT,
    ucAmount TEXT,
    bundle TEXT,
    transactionId TEXT,
    totalAmount REAL,
    screenshot TEXT,
    status TEXT DEFAULT 'قيد الانتظار',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // جدول الاستفسارات
  db.run(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT,
    status TEXT DEFAULT 'لم يتم الرد',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // جدول الاقتراحات
  db.run(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    contact TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // جدول المسؤولين
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  // إضافة مستخدم مسؤول افتراضي إذا لم يكن موجود
  db.get("SELECT COUNT(*) as count FROM admins", (err, row) => {
    if (row && row.count === 0) {
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
      db.run("INSERT INTO admins (username, password) VALUES (?, ?)", 
        ['admin', defaultPassword], function(err) {
          if (err) {
            console.error('خطأ في إضافة المسؤول الافتراضي:', err);
          } else {
            console.log('تم إضافة المسؤول الافتراضي بنجاح');
          }
        });
    }
  });
});

// تكوين nodemailer لإرسال البريد الإلكتروني - التصحيح هنا
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// وظيفة لإرسال رسالة إلى التيليجرام
async function sendTelegramMessage(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('إعدادات التيليجرام غير مكتملة');
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('تم إرسال رسالة التيليجرام بنجاح');
  } catch (error) {
    console.error('خطأ في إرسال رسالة التيليجرام:', error.message);
  }
}

// وظيفة لإرسال بريد إلكتروني
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html
    });
    console.log('تم إرسال البريد الإلكتروني بنجاح إلى:', to);
    return true;
  } catch (error) {
    console.error('خطأ في إرسال البريد الإلكتروني:', error.message);
    return false;
  }
}

// Routes

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// صفحة الدفع
app.get('/pay.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pay.html'));
});

// لوحة التحكم
app.get('/dashboard.html', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// صفحة تسجيل الدخول
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// معالجة تسجيل الدخول
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get("SELECT * FROM admins WHERE username = ? AND password = ?", 
    [username, password], (err, row) => {
    if (err) {
      console.error('خطأ في قاعدة البيانات:', err);
      return res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
    
    if (row) {
      req.session.isLoggedIn = true;
      res.json({ success: true, message: 'تم تسجيل الدخول بنجاح' });
    } else {
      res.status(401).json({ success: false, message: 'بيانات الاعتماد غير صحيحة' });
    }
  });
});

// تسجيل الخروج
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('خطأ في تسجيل الخروج:', err);
      return res.status(500).json({ success: false, message: 'خطأ في تسجيل الخروج' });
    }
    res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
  });
});

// معالجة طلب شراء
app.post('/api/order', upload.single('screenshot'), async (req, res) => {
  try {
    const { name, playerId, email, ucAmount, bundle, transactionId, totalAmount } = req.body;
    const screenshot = req.file ? req.file.filename : null;

    console.log('استلام طلب جديد:', { name, playerId, email, ucAmount, bundle, transactionId, totalAmount });

    // حفظ الطلب في قاعدة البيانات
    db.run(`INSERT INTO orders (name, playerId, email, ucAmount, bundle, transactionId, totalAmount, screenshot) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, playerId, email, ucAmount, bundle, transactionId, totalAmount, screenshot],
      function(err) {
        if (err) {
          console.error('خطأ في حفظ الطلب:', err);
          return res.status(500).json({ success: false, message: 'خطأ في حفظ الطلب' });
        }

        const orderId = this.lastID;
        console.log('تم حفظ الطلب برقم:', orderId);
        
        // إرسال إشعار إلى التيليجرام
        const telegramMessage = `
          <b>طلب جديد!</b>
          الاسم: ${name}
          ID اللاعب: ${playerId}
          البريد الإلكتروني: ${email}
          ${ucAmount ? `عدد الشدات: ${ucAmount}` : `الحزمة: ${bundle}`}
          المبلغ: ${totalAmount} ج.م
          رقم التحويل: ${transactionId}
          رقم الطلب: ${orderId}
        `;
        sendTelegramMessage(telegramMessage);

        // إرسال بريد إلكتروني إلى المسؤول
        const emailSubject = `طلب جديد - ${orderId}`;
        const emailHtml = `
          <h2>طلب جديد</h2>
          <p><strong>الاسم:</strong> ${name}</p>
          <p><strong>ID اللاعب:</strong> ${playerId}</p>
          <p><strong>البريد الإلكتروني:</strong> ${email}</p>
          <p><strong>${ucAmount ? 'عدد الشدات:' : 'الحزمة:'}</strong> ${ucAmount || bundle}</p>
          <p><strong>المبلغ:</strong> ${totalAmount} ج.م</p>
          <p><strong>رقم التحويل:</strong> ${transactionId}</p>
          <p><strong>رقم الطلب:</strong> ${orderId}</p>
        `;
        
        if (process.env.ADMIN_EMAIL) {
          sendEmail(process.env.ADMIN_EMAIL, emailSubject, emailHtml);
        } else {
          console.log('لم يتم تحديد بريد المسؤول');
        }

        res.json({ success: true, orderId: orderId });
      }
    );
  } catch (error) {
    console.error('خطأ في معالجة الطلب:', error);
    res.status(500).json({ success: false, message: 'خطأ في معالجة الطلب' });
  }
});

// معالجة الاستفسارات
app.post('/api/inquiry', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    console.log('استلام استفسار جديد:', { name, email, message });

    // حفظ الاستفسار في قاعدة البيانات
    db.run(`INSERT INTO inquiries (name, email, message) VALUES (?, ?, ?)`,
      [name, email, message],
      function(err) {
        if (err) {
          console.error('خطأ في حفظ الاستفسار:', err);
          return res.status(500).json({ success: false, message: 'خطأ في حفظ الاستفسار' });
        }

        const inquiryId = this.lastID;
        console.log('تم حفظ الاستفسار برقم:', inquiryId);
        
        // إرسال إشعار إلى التيليجرام
        const telegramMessage = `
          <b>استفسار جديد!</b>
          الاسم: ${name}
          البريد الإلكتروني: ${email}
          الرسالة: ${message}
          رقم الاستفسار: ${inquiryId}
        `;
        sendTelegramMessage(telegramMessage);

        // إرسال بريد إلكتروني إلى المسؤول
        const emailSubject = `استفسار جديد - ${inquiryId}`;
        const emailHtml = `
          <h2>استفسار جديد</h2>
          <p><strong>الاسم:</strong> ${name}</p>
          <p><strong>البريد الإلكتروني:</strong> ${email}</p>
          <p><strong>الرسالة:</strong> ${message}</p>
          <p><strong>رقم الاستفسار:</strong> ${inquiryId}</p>
        `;
        
        if (process.env.ADMIN_EMAIL) {
          sendEmail(process.env.ADMIN_EMAIL, emailSubject, emailHtml);
        } else {
          console.log('لم يتم تحديد بريد المسؤول');
        }

        res.json({ success: true, message: 'تم إرسال الاستفسار بنجاح' });
      }
    );
  } catch (error) {
    console.error('خطأ في معالجة الاستفسار:', error);
    res.status(500).json({ success: false, message: 'خطأ في معالجة الاستفسار' });
  }
});

// معالجة الاقتراحات
app.post('/api/suggestion', async (req, res) => {
  try {
    const { name, contact, message } = req.body;

    console.log('استلام اقتراح جديد:', { name, contact, message });

    // حفظ الاقتراح في قاعدة البيانات
    db.run(`INSERT INTO suggestions (name, contact, message) VALUES (?, ?, ?)`,
      [name, contact, message],
      function(err) {
        if (err) {
          console.error('خطأ في حفظ الاقتراح:', err);
          return res.status(500).json({ success: false, message: 'خطأ في حفظ الاقتراح' });
        }

        const suggestionId = this.lastID;
        console.log('تم حفظ الاقتراح برقم:', suggestionId);
        
        // إرسال إشعار إلى التيليجرام
        const telegramMessage = `
          <b>اقتراح جديد!</b>
          الاسم: ${name}
          طريقة التواصل: ${contact}
          الاقتراح: ${message}
          رقم الاقتراح: ${suggestionId}
        `;
        sendTelegramMessage(telegramMessage);

        // إرسال بريد إلكتروني إلى المسؤول
        const emailSubject = `اقتراح جديد - ${suggestionId}`;
        const emailHtml = `
          <h2>اقتراح جديد</h2>
          <p><strong>الاسم:</strong> ${name}</p>
          <p><strong>طريقة التواصل:</strong> ${contact}</p>
          <p><strong>الاقتراح:</strong> ${message}</p>
          <p><strong>رقم الاقتراح:</strong> ${suggestionId}</p>
        `;
        
        if (process.env.ADMIN_EMAIL) {
          sendEmail(process.env.ADMIN_EMAIL, emailSubject, emailHtml);
        } else {
          console.log('لم يتم تحديد بريد المسؤول');
        }

        res.json({ success: true, message: 'تم إرسال الاقتراح بنجاح' });
      }
    );
  } catch (error) {
    console.error('خطأ في معالجة الاقتراح:', error);
    res.status(500).json({ success: false, message: 'خطأ في معالجة الاقتراح' });
  }
});

// API للوحة التحكم - جلب الطلبات
app.get('/api/admin/orders', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  db.all("SELECT * FROM orders ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('خطأ في جلب الطلبات:', err);
      return res.status(500).json({ success: false, message: 'خطأ في جلب الطلبات' });
    }
    res.json({ success: true, data: rows });
  });
});

// API للوحة التحكم - جلب الاستفسارات
app.get('/api/admin/inquiries', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  db.all("SELECT * FROM inquiries ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('خطأ في جلب الاستفسارات:', err);
      return res.status(500).json({ success: false, message: 'خطأ في جلب الاستفسارات' });
    }
    res.json({ success: true, data: rows });
  });
});

// API للوحة التحكم - جلب الاقتراحات
app.get('/api/admin/suggestions', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  db.all("SELECT * FROM suggestions ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error('خطأ في جلب الاقتراحات:', err);
      return res.status(500).json({ success: false, message: 'خطأ في جلب الاقتراحات' });
    }
    res.json({ success: true, data: rows });
  });
});

// API للوحة التحكم - تحديث حالة الطلب
app.post('/api/admin/update-status', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { id, status } = req.body;
  db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id], (err) => {
    if (err) {
      console.error('خطأ في تحديث الحالة:', err);
      return res.status(500).json({ success: false, message: 'خطأ في تحديث الحالة' });
    }
    res.json({ success: true, message: 'تم تحديث الحالة بنجاح' });
  });
});

// API للوحة التحكم - حذف طلب
app.delete('/api/admin/delete-order', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { id } = req.body;
  db.run("DELETE FROM orders WHERE id = ?", [id], (err) => {
    if (err) {
      console.error('خطأ في حذف الطلب:', err);
      return res.status(500).json({ success: false, message: 'خطأ في حذف الطلب' });
    }
    res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
  });
});

// API للوحة التحكم - حذف استفسار
app.delete('/api/admin/delete-inquiry', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { id } = req.body;
  db.run("DELETE FROM inquiries WHERE id = ?", [id], (err) => {
    if (err) {
      console.error('خطأ في حذف الاستفسار:', err);
      return res.status(500).json({ success: false, message: 'خطأ في حذف الاستفسار' });
    }
    res.json({ success: true, message: 'تم حذف الاستفسار بنجاح' });
  });
});

// API للوحة التحكم - حذف اقتراح
app.delete('/api/admin/delete-suggestion', (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { id } = req.body;
  db.run("DELETE FROM suggestions WHERE id = ?", [id], (err) => {
    if (err) {
      console.error('خطأ في حذف الاقتراح:', err);
      return res.status(500).json({ success: false, message: 'خطأ في حذف الاقتراح' });
    }
    res.json({ success: true, message: 'تم حذف الاقتراح بنجاح' });
  });
});

// API للوحة التحكم - الرد على الاستفسار
app.post('/api/admin/reply-inquiry', async (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { inquiryId, email, message, reply } = req.body;

  try {
    // تحديث حالة الاستفسار إلى "تم الرد"
    db.run("UPDATE inquiries SET status = 'تم الرد' WHERE id = ?", [inquiryId]);

    // إرسال الرد بالبريد الإلكتروني
    const emailSubject = "رد على استفسارك";
    const emailHtml = `
      <h2>شكراً لتواصلك معنا</h2>
      <p><strong>استفسارك:</strong> ${message}</p>
      <p><strong>ردنا:</strong> ${reply}</p>
      <br>
      <p>مع تحيات،<br>فريق King STORE个ESPORTSツ</p>
    `;

    const emailSent = await sendEmail(email, emailSubject, emailHtml);
    if (emailSent) {
      res.json({ success: true, message: 'تم إرسال الرد بنجاح' });
    } else {
      res.status(500).json({ success: false, message: 'خطأ في إرسال الرد' });
    }
  } catch (error) {
    console.error('خطأ في إرسال الرد:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال الرد' });
  }
});

// API للوحة التحكم - إرسال رسالة مباشرة
app.post('/api/admin/send-message', async (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  const { email, subject, message } = req.body;

  try {
    // إرسال الرسالة بالبريد الإلكتروني
    const emailHtml = `
      <h2>${subject}</h2>
      <p>${message}</p>
      <br>
      <p>مع تحيات،<br>فريق King STORE个ESPORTSツ</p>
    `;

    const emailSent = await sendEmail(email, subject, emailHtml);
    if (emailSent) {
      res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
    } else {
      res.status(500).json({ success: false, message: 'خطأ في إرسال الرسالة' });
    }
  } catch (error) {
    console.error('خطأ في إرسال الرسالة:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال الرسالة' });
  }
});

// معالجة الأخطاء - يجب أن يكون هذا في النهاية
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'المسار غير موجود' });
});

// بدء الخادم
app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
  console.log(`يمكنك الوصول إلى التطبيق على: http://localhost:${PORT}`);
});
