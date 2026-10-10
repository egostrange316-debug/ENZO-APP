const mongoose = require('mongoose');

/** Talaffuz urinishlari tarixi (o'qituvchi o'quvchining rivojlanishini ko'ra oladi). Audio SAQLANMAYDI. */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    word: { type: String, required: true },
    day_number: { type: Number },
    score: { type: Number, required: true },        // yakuniy ball 0-100
    heard: { type: String, default: '' },           // Gemini eshitgan matn
    ai_score: { type: Number },                     // Gemini bahosi
    text_score: { type: Number },                   // eshitilgan matn va maqsad so'z o'xshashligi
    feedback_uz: { type: String, default: '' },
    tip_uz: { type: String, default: '' },
  },
  { timestamps: true }
);
schema.index({ user: 1, createdAt: -1 });
module.exports = mongoose.model('PronunciationAttempt', schema);
