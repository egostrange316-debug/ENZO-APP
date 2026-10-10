const mongoose = require('mongoose');

/**
 * "Mashq" bo'limi: o'quvchi xato qilgan savol/so'z AVTOMATIK shu yerga tushadi (hech kim qo'lda qo'shmaydi).
 * Ketma-ket PRACTICE_CLEAR_STREAK marta to'g'ri javob berilsa 'done' bo'ladi va mashqdan chiqadi; yana xato qilsa qaytadan 'active'.
 * (day_number, key) — kunning o'sha savoli; savol matni va to'g'ri javob kontentdan olinadi, bu yerda saqlanmaydi.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day_number: { type: Number, required: true },
    key: { type: String, required: true },
    status: { type: String, enum: ['active', 'done'], default: 'active' },
    streak: { type: Number, default: 0 },        // ketma-ket to'g'ri javoblar
    wrong_total: { type: Number, default: 0 },
    added_at: { type: Date, default: Date.now },
    last_at: { type: Date, default: Date.now },
    done_at: { type: Date },
  },
  { timestamps: false }
);
schema.index({ user: 1, day_number: 1, key: 1 }, { unique: true });
schema.index({ user: 1, status: 1, wrong_total: -1 });

module.exports = mongoose.model('PracticeItem', schema);
