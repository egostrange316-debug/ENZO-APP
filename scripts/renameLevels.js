/**
 * Daraja nomlari o'zgargan (advanced olib tashlangan; 101-200 = pre-intermediate, 201-300 = intermediate,
 * 301-400 = upper-intermediate). Mavjud foydalanuvchilar va reja kunlarining `level` maydonini kundan qayta hisoblaydi.
 *
 *   node scripts/renameLevels.js
 * Xavfsiz: istagancha marta ishga tushirish mumkin.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const { TOTAL_DAYS, levelForDay } = require('../config/curriculum');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let users = 0;
  let plans = 0;
  for (const u of await User.find({}).select('current_day level')) {
    const lvl = levelForDay(Math.min(u.current_day, TOTAL_DAYS));
    if (u.level !== lvl) { await User.updateOne({ _id: u._id }, { $set: { level: lvl } }); users++; }
  }
  for (const p of await StudyPlan.find({}).select('day_number level')) {
    const lvl = levelForDay(p.day_number);
    if (p.level !== lvl) { await StudyPlan.updateOne({ _id: p._id }, { $set: { level: lvl } }); plans++; }
  }
  console.log(`Yangilandi: ${users} ta foydalanuvchi, ${plans} ta reja kuni`);
  process.exit(0);
})();
