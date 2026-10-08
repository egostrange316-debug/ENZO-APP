const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * 'protect' — so'rov headerida Bearer token borligini va u to'g'riligini tekshiradi.
 * To'g'ri bo'lsa req.user ga to'liq foydalanuvchi hujjatini yozadi.
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Avtorizatsiya talab qilinadi (token topilmadi)' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Foydalanuvchi topilmadi' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati o\'tgan' });
  }
};

/**
 * 'adminOnly' — faqat role === 'admin' bo'lgan foydalanuvchilarga ruxsat beradi.
 * 'protect' dan KEYIN ishlatilishi shart (req.user allaqachon o'rnatilgan bo'lishi kerak).
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Bu amal faqat Admin uchun ruxsat etilgan' });
  }
  next();
};

module.exports = { protect, adminOnly };
