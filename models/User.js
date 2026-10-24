const mongoose = require('mongoose');
const { LEVELS, SUBSCRIPTION_DAYS } = require('../config/curriculum');

/**
 * Foydalanuvchi (o'quvchi/admin) modeli.
 *
 * - current_day            -> 1..646 (647 = kurs tugagan). Daraja shundan hisoblanadi.
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
    placement_pending: { type: Boolean, default: false }, // yangi o'quvchi o'zi tanlagan daraja; o'qituvchi tasdiqlamaguncha true
    current_day: { type: Number, default: 1, min: 1 },

    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    subscription_end_date: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000),
    },

    // To'lovlar tarixi (faqat o'qituvchi ko'radi). Oxirgi 24 ta saqlanadi.
    payments: {
      type: [
        {
          _id: false,
          paid_at: { type: Date, default: Date.now },
          paid_through: Date, // obuna shu sanagacha ochilgan
          kind: { type: String, enum: ['month', 'custom'] },
          months: Number,
          amount: Number, // naqd summa (so'm), ixtiyoriy — faqat o'qituvchi ko'radi
          note: String,
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },

    // O'yin tizimi (XP, tanga, streak, nishonlar, do'kon). Hammasi serverda hisoblanadi.
    xp: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    week_key: { type: String, default: '' }, // "2026-W41" — haftalik XP shu hafta uchun
    week_xp: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    best_streak: { type: Number, default: 0 },
    last_study_date: { type: String, default: '' }, // "YYYY-MM-DD" (Toshkent vaqti)
    streak_freezes: { type: Number, default: 0 },
    days_done: { type: Number, default: 0 },
    exams_passed: { type: Number, default: 0 },
    perfect_exams: { type: Number, default: 0 },
    games_played: { type: Number, default: 0 },
    game_xp_today: { type: Number, default: 0 },
    game_xp_date: { type: String, default: '' },
    badges: { type: [{ _id: false, id: String, at: { type: Date, default: Date.now } }], default: [] },
    owned_items: { type: [String], default: ['av_lion', 'av_cat'] },
    equipped: { _id: false, type: { avatar: String, frame: String, theme: String }, default: () => ({ avatar: 'av_lion' }) },

    // 450 kunlik kurs xulosasi (telefondan sinxronlanadi; to'liq holat CourseState'da)
    course_day: { type: Number, default: 0 },
    course_days_done: { type: Number, default: 0 },
    course_points: { type: Number, default: 0 },
    course_accuracy: { type: Number, default: null },
    course_last_date: { type: String, default: '' },

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
