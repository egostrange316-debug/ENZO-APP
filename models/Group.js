const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    name_key: { type: String, required: true, unique: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);
groupSchema.statics.keyOf = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = mongoose.model('Group', groupSchema);
