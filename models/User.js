const mongoose = require('mongoose');
const { LEVELS, SUBSCRIPTION_DAYS } = require('../config/curriculum');

/**
 * Foydalanuvchi (o'quvchi/admin) modeli.
 *
 * - current_day            -> 1..400 (401 = kurs tugagan). Daraja shundan hisoblanadi.
 * - status                 -> 'active' | 'blocked'. Faqat Admin 'blocked' dan chiqara oladi.
 * - subscription_end_date  -> o'tib ketsa, middleware avtomatik 'blocked' qiladi.
 * - legacy_id              -> eski Supabase students.id (uuid). Ilovaning chat/uy vazifasi/jurnal
 *                             qismlari hali Supabase'da bo'lgani uchun ikkala bazani bog'laydi.
 *
 * Login: ism-familiya (katta-kichik harfga e'tiborsiz) + parol — eski ilovadagi kabi.
 */
const userSchema = new mongoose.Schema(
  {
    full_name: { type: String, required: true, trim: true },
    // Kichik harfli, bo'shliqlari birlashtirilgan ism — noyoblik va login shu bo'yicha (collation'siz, har qanday Mongo'da ishlaydi)
    name_key: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },

    group_name: { type: String, trim: true, default: null },
    avatar: { type: String, default: null },
    ball: { type: Number, default: 0 },
    words_count: { type: Number, default: 0 },

    level: { type: String, enum: LEVELS, default: LEVELS[0] },
    current_day: { type: Number, default: 1, min: 1 },

    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    subscription_end_date: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000),
    },

    legacy_id: { type: String }, // DIQQAT: default YO'Q — unique sparse indeksda null'lar to'qnashadi
    last_active_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSchema.index({ legacy_id: 1 }, { unique: true, sparse: true });

const nameKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

userSchema.pre('validate', function (next) {
  if (this.full_name) this.name_key = nameKey(this.full_name);
  next();
});

const User = mongoose.model('User', userSchema);
User.nameKey = nameKey;
module.exports = User;
