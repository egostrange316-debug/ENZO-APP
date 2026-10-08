require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET .env faylida yo\'q yoki juda qisqa (kamida 16 belgi)');
  process.exit(1);
}

const app = express();

// Render/Railway kabi proxy ortida to'g'ri IP uchun
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Parol tanlab urinishdan himoya: bir IP dan 15 daqiqada 30 ta login/register urinishi
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/student', studentRoutes);
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
