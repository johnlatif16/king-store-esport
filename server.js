require('dotenv').config();
const express = require('express');
const session = require('express-session'); // هنا مرة واحدة فقط
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

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// إعداد CORS
const allowedOrigins = [
  'https://store-king-esport-production-f149.up.railway.app',
  'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    const allowed = [
      'https://store-king-esport-production-f149.up.railway.app',
      'http://localhost:3000'
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.error('CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// إعداد الجلسة
const session = require('express-session');
const FileStore = require('session-file-store')(session); // أضف هذا

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new FileStore({ path: './sessions' }), // أضف هذا
  cookie: {
    secure: true, // يجب أن يكون true في الإنتاج
    httpOnly: true,
    sameSite: 'none',
    domain: '.railway.app',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
// إضافة هذا المسار قبل middleware المصادقة
app.get('/api/admin/check', (req, res) => {
  res.json({ 
    alive: true,
    session: req.session 
  });
});

// تعديل middleware المصادقة
function adminAuth(req, res, next) {
  console.log('Session data:', req.session); // للتتبع
  if (req.session && req.session.admin) {
    next();
  } else {
    console.error('Access denied for:', req.path);
    res.status(401).json({  // تغيير من 403 إلى 401
      success: false, 
      message: "غير مصرح بالوصول - يرجى تسجيل الدخول"
    });
  }
}



// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || 'gmail',
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendEmail(to, subject, text) {
  try {
    const mailOptions = {
      from: `"STORE King" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html: `<p>${text.replace(/\n/g, '<br>')}</p>`
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// ========== نقاط النهاية ========== //

// نقطة تسجيل الدخول
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "اسم المستخدم وكلمة المرور مطلوبان" });
    }

    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
      req.session.regenerate(err => {
        if (err) throw err;
        
        req.session.admin = true;
        req.session.save(err => {
          if (err) {
            console.error('Session save error:', err);
            return res.status(500).json({ success: false, message: "فشل في حفظ الجلسة" });
          }
          return res.json({ 
            success: true,
            message: "تم تسجيل الدخول بنجاح",
            session: req.session
          });
        });
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: "بيانات الدخول غير صحيحة" 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: "حدث خطأ في الخادم" 
    });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// نقطة التحقق من الجلسة
app.get('/api/admin/check-session', (req, res) => {
  console.log('Session check:', req.session); // للتتبع
  if (req.session && req.session.admin) {
    res.json({ 
      authenticated: true,
      session: req.session 
    });
  } else {
    res.status(401).json({ 
      authenticated: false,
      message: "غير مصرح بالوصول",
      session: req.session
    });
  }
});

app.get('/api/admin/orders', adminAuth, (req, res) => {
  try {
    res.json(db.orders);
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في جلب الطلبات" });
  }
});

app.get('/api/admin/inquiries', adminAuth, (req, res) => {
  try {
    res.json(db.inquiries);
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في جلب الاستفسارات" });
  }
});

app.post('/api/admin/update-status', adminAuth, (req, res) => {
  try {
    const { id, status } = req.body;
    const order = db.orders.find(o => o.id === id);
    
    if (order) {
      order.status = status;
      saveDB();
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "الطلب غير موجود" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في تحديث الحالة" });
  }
});

app.delete('/api/admin/delete-order', adminAuth, (req, res) => {
  try {
    const { id } = req.body;
    db.orders = db.orders.filter(o => o.id !== id);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في حذف الطلب" });
  }
});

app.delete('/api/admin/delete-inquiry', adminAuth, (req, res) => {
  try {
    const { id } = req.body;
    db.inquiries = db.inquiries.filter(i => i.id !== id);
    saveDB();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "خطأ في حذف الاستفسار" });
  }
});

app.post('/api/admin/send-email', adminAuth, async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    
    if (!to || !subject || !message) {
      return res.status(400).json({ success: false, message: "جميع الحقول مطلوبة" });
    }

    const mailOptions = {
      from: `"STORE King" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: message,
      html: `<p>${message.replace(/\n/g, '<br>')}</p>`
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "تم إرسال البريد بنجاح" });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ 
      success: false, 
      message: "فشل إرسال البريد: " + error.message 
    });
  }
});

app.post('/api/order', async (req, res) => {
  try {
    const order = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      status: "قيد المراجعة",
      ...req.body
    };
    
    db.orders.push(order);
    saveDB();
    
    await sendEmail(
      order.email,
      'تم استلام طلبك',
      `مرحباً ${order.name},\n\nتم استلام طلبك بنجاح وسيتم مراجعته قريباً.\n\nرقم الطلب: ${order.id}`
    );

    if (process.env.ADMIN_EMAIL) {
      await sendEmail(
        process.env.ADMIN_EMAIL,
        'طلب جديد تم استلامه',
        `تم استلام طلب جديد من ${order.name}\n\nالمبلغ: ${order.totalAmount} جنيه`
      );
    }

    res.json({ success: true, message: "تم استلام الطلب بنجاح" });
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ success: false, message: "خطأ في استقبال الطلب" });
  }
});

app.post('/api/inquiry', async (req, res) => {
  try {
    const inquiry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      ...req.body
    };
    
    db.inquiries.push(inquiry);
    saveDB();
    
    await sendEmail(
      inquiry.email,
      'تم استلام استفسارك',
      `شكراً لتواصلك معنا.\n\nسيتم الرد على استفسارك في أقرب وقت ممكن.\n\nرسالتك:\n${inquiry.message}`
    );

    if (process.env.ADMIN_EMAIL) {
      await sendEmail(
        process.env.ADMIN_EMAIL,
        'استفسار جديد',
        `استفسار جديد من ${inquiry.email}\n\nالرسالة:\n${inquiry.message}`
      );
    }

    res.json({ success: true, message: "تم استلام الاستفسار بنجاح" });
  } catch (error) {
    console.error('Inquiry error:', error);
    res.status(500).json({ success: false, message: "خطأ في استقبال الاستفسار" });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});