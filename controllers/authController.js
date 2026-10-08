const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { evaluateSubscription } = require('../middleware/checkSubscription');

const GROUPS = ['1-guruh', '2-guruh', '3-guruh', '4-guruh', 'Qizlar guruhi'];

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

/** Ilova kutadigan, parolsiz foydalanuvchi ko'rinishi */
function publicUser(u) {
  return {
    id: u._id,
    legacy_id: u.legacy_id,
    full_name: u.full_name,
    role: u.role,
    group_name: u.group_name,
    avatar: u.avatar,
    level: u.level,
    current_day: u.current_day,
    status: u.status,
    subscription_end_date: u.subscription_end_date,
  };
}

/**
 * POST /api/auth/register  { full_name, password, group_name }
 * legacy_id shu yerda yaratiladi — ilova uni Supabase'dagi students qatori id'si sifatida
 * ishlatadi (chat/uy vazifasi/jurnal hali Supabase'da bo'lgani uchun).
 */
const registerStudent = async (req, res) => {
  try {
    const full_name = String(req.body.full_name || '').trim();
    const password = String(req.body.password || '');
    const group_name = req.body.group_name;

    if (!full_name || !password) {
      return res.status(400).json({ message: 'Ism familiya va parol majburiy' });
    }
    if (password.length < 4) {
      return res.status(400).json({ message: "Parol kamida 4 ta belgidan iborat bo'lishi kerak" });
    }
    if (!GROUPS.includes(group_name)) {
      return res.status(400).json({ message: "Guruh noto'g'ri tanlangan" });
    }

    const existing = await User.findOne({ name_key: User.nameKey(full_name) });
    if (existing) return res.status(409).json({ message: 'Bu ism band, boshqasini tanlang' });

    const student = await User.create({
      full_name,
      group_name,
      password_hash: await bcrypt.hash(password, 10),
      legacy_id: crypto.randomUUID(),
    });

    return res.status(201).json({ token: generateToken(student._id), user: publicUser(student) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Bu ism band, boshqasini tanlang' });
    console.error('registerStudent xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/auth/login  { full_name, password }
 * Bloklangan o'quvchi ham login qila oladi (javobda status: 'blocked') — shunda ilova
 * "Bloklangan" ekranini ko'rsata oladi. Darslar esa 403 qaytaradi.
 */
const login = async (req, res) => {
  try {
    const full_name = String(req.body.full_name || '').trim();
    const password = String(req.body.password || '');
    if (!full_name || !password) {
      return res.status(400).json({ message: 'Ism familiya va parolni kiriting' });
    }

    const user = await User.findOne({ name_key: User.nameKey(full_name) });
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ message: "Ism yoki parol noto'g'ri" });

    if (user.role === 'student') await evaluateSubscription(user);

    return res.status(200).json({ token: generateToken(user._id), user: publicUser(user) });
  } catch (error) {
    console.error('login xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { registerStudent, login, publicUser, GROUPS };
