const mongoose = require('mongoose');

/**
 * Bitta savol bo'yicha o'quvchi holati: (user, day_number, key) noyob.
 * HAR SAVOL ALOHIDA HUJJAT — shuning uchun bir vaqtdagi javoblar (qo'sh bosish, ikki qurilma) bir-biriga
 * tegmaydi va hech qanday massivni qayta yozish yo'q. Hujjat yo'q = savol hali 'pending'.
 * Foizlar saqlanmaydi: servis (summarize) shu hujjatlardan hisoblaydi, shuning uchun hech qachon "eskirmaydi".
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day_number: { type: Number, required: true },
    key: { type: String, required: true }, // 'q:0', 'f:1', kitob savollari uchun 'b<...>'
    status: { type: String, enum: ['pending', 'done'], default: 'pending' },
    wrong: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    first_try: { type: Boolean, default: false }, // birinchi urinishda to'g'ri topdimi
    lenient: { type: Boolean, default: false }, // shartlar to'liq bajarilmagan, lekin urinishlardan keyin qabul qilingan (o'qituvchi ko'rsin)
    answer_text: { type: String }, // Writing/Speaking: bolaning yozgani yoki aytgani (o'qituvchi ko'radi)
    done_at: { type: Date },
    last_activity_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

schema.index({ user: 1, day_number: 1, key: 1 }, { unique: true });
schema.index({ day_number: 1, status: 1 });

module.exports = mongoose.model('ExerciseProgress', schema);
