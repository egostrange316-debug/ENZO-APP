const mongoose = require('mongoose');

/** Kunlik mashq bajarilgan kunlar (Toshkent sanasi, YYYY-MM-DD). XP kuniga bir marta beriladi (unikal indeks). */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    xp: { type: Number, default: 0 },
  },
  { timestamps: true }
);
schema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('PracticeDay', schema);
