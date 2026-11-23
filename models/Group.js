const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    name_key: { type: String, required: true, unique: true },
    order: { type: Number, default: 0 },
    // Dars jadvali (Toshkent vaqti). Du=1 ... Ya=7. Bo'sh = Du–Sha.
    lesson_days: { type: [Number], default: undefined },
    deadline_hour: { type: Number, default: 20 }, // shu soatgacha vazifa bajarilmasa "qizil"
    off_dates: { type: [String], default: [] }, // "bugun dars yo'q" kunlari (YYYY-MM-DD)
    extra_dates: { type: [String], default: [] }, // qo'shimcha dars kunlari
  },
  { timestamps: true }
);
groupSchema.statics.keyOf = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = mongoose.model('Group', groupSchema);
