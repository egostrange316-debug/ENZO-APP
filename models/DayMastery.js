const mongoose = require('mongoose');

/**
 * Mavzu (kun) o'zlashtirish holati. Kun to'liq bajarilganda birinchi urinishdagi to'g'ri javoblar ulushi
 * MASTERY_THRESHOLD_PERCENT dan past bo'lsa, mashqlar noldan boshlanadi (qayta o'tish) — bola keyingi kunga o'tmaydi.
 * Ko'p marta qaytarilsa needs_teacher belgilanadi: o'qituvchi ko'radi va xohlasa qo'lda o'tkazadi.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day_number: { type: Number, required: true },
    passes: { type: Number, default: 0 },          // kun necha marta oxirigacha bajarilgan
    last_percent: { type: Number, default: 0 },    // oxirgi bajarishdagi first-try %
    best_percent: { type: Number, default: 0 },
    mastered: { type: Boolean, default: false },
    needs_teacher: { type: Boolean, default: false },
    teacher_passed: { type: Boolean, default: false },
    mastered_at: { type: Date },
  },
  { timestamps: true }
);
schema.index({ user: 1, day_number: 1 }, { unique: true });

module.exports = mongoose.model('DayMastery', schema);
