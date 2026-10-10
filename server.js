require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const bookRoutes = require('./routes/bookRoutes');
const bookPlanRoutes = require('./routes/bookPlanRoutes');
const classRoutes = require('./routes/classRoutes');
const { UPLOAD_DIR } = require('./lib/imageUpload');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET .env faylida yo\'q yoki juda qisqa (kamida 16 belgi)');
  process.exit(1);
}

const app = express();

// Render/Railway kabi proxy ortida to'g'ri IP uchun
app.set('trust proxy', 1);

app.use(compression()); // JSON javoblarni siqadi: sekin mobil internetda tezroq
app.use(cors());
// Talaffuz audiosi base64 (~2 MB gacha) — faqat shu marshrut katta tanani qabul qiladi
app.use('/api/student/pronunciation', express.json({ limit: '3mb' }));
app.use(express.json({ limit: '2mb' }));

// Parol tanlab urinishdan himoya: bir IP dan 15 daqiqada 30 ta MUVAFFAQIYATSIZ urinish.
// Muvaffaqiyatli kirishlar sanalmaydi — maktabda hamma bola bitta WiFi (bitta IP) dan kirsa ham bloklanmaydi.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." },
});

// Ommaviy soxta ro'yxatdan o'tishdan himoya: bir IP dan soatiga 100 ta (maktabda 30-40 bola bir vaqtda ro'yxatdan o'tsa ham yetadi)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bu tarmoqdan juda ko'p ro'yxatdan o'tish urinishi bo'ldi. Keyinroq urinib ko'ring yoki o'qituvchiga murojaat qiling." },
});
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/class', classRoutes);
// Yuklangan rasmlar (avatar, uy vazifasi). Nomlar tasodifiy; faqat rasm baytlari qabul qilinadi.
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/api/admin/books', bookRoutes);
app.use('/api/admin/book-plans', bookPlanRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Kids English Backend ishlayapti' }));

app.use((req, res) => res.status(404).json({ message: 'Marshrut topilmadi' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Kutilmagan xato:', err);
  res.status(err.status || 500).json({ message: err.message || 'Server xatosi' });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  connectDB().then(() => app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`)));
}

module.exports = app;
