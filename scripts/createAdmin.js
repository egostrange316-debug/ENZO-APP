/**
 * Birinchi Admin foydalanuvchini yaratadi (yoki mavjudining parolini yangilaydi).
 *
 *   node scripts/createAdmin.js "Enzo Academy" "YangiMaxfiyParol"
 *
 * Eski ilovada admin paroli kodning ichiga yozilgan edi (App.jsx) — endi u ishlatilmaydi.
 * Yangi parol FAQAT shu yerda belgilanadi va bazada bcrypt bilan saqlanadi.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  const [name, password] = process.argv.slice(2);
  if (!name || !password || password.length < 8) {
    console.error('Foydalanish: node scripts/createAdmin.js "<ism>" "<parol (kamida 8 belgi)>"');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const password_hash = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ name_key: User.nameKey(name) });
  if (existing) {
    existing.password_hash = password_hash;
    existing.role = 'admin';
    existing.status = 'active';
    await existing.save();
    console.log(`Mavjud foydalanuvchi admin qilindi va paroli yangilandi: ${existing.full_name}`);
  } else {
    await User.create({ full_name: name, password_hash, role: 'admin' });
    console.log(`Admin yaratildi: ${name}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
