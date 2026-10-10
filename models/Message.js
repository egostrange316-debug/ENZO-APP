const mongoose = require('mongoose');

/** O'quvchilar o'rtasidagi shaxsiy xabarlar. */
const schema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);
schema.index({ from: 1, to: 1, createdAt: 1 });
schema.index({ to: 1, createdAt: -1 });

module.exports = mongoose.model('Message', schema);
