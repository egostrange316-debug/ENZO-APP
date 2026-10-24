const mongoose = require('mongoose');

/** Davomat: o'quvchi + kun (YYYY-MM-DD, Toshkent kuni) bo'yicha bitta yozuv. */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ['present', 'absent', 'late', 'excused'], required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ user: 1, date: 1 }, { unique: true });
schema.index({ date: 1 });

module.exports = mongoose.model('Attendance', schema);
