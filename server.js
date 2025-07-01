require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
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
    if (!origin || allowedOrigins.includes(origin)) {
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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// إعداد الجلسة
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new FileStore({ path: './sessions' }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.railway.app' : 'localhost',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// نقطة فحص الخادم
app.get('/api/admin/check', (req, res) => {
  res.json({ 
    alive: true,
    session: req.session 
  });
});

// middleware المصادقة
function adminAuth(req, res, next) {
  console.log('Session data:', req.session);
  if (req.session && req.session.admin) {
    next();
  } else {
    console.error('Access denied for:', req.path);
    res.status(401).json({ 
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

app.get('/api/admin/check-session', (req, res) => {
  console.log('Session check:', req.session);
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

// ... بقية نقاط النهاية (orders, inquiries, etc) تبقى كما هي بدون تغيير ...

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