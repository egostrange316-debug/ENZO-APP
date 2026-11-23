const mongoose = require('mongoose');
// Kun testi (Enzo test tizimi) natijalari: o'quvchiga bitta hujjat. Kalit ma'nosi: v:<kun>:<qism>, g:<kun>
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  res: { type: mongoose.Schema.Types.Mixed, default: {} },
  prep: { type: mongoose.Schema.Types.Mixed, default: {} },
  done: { type: mongoose.Schema.Types.Mixed, default: {} },
  err: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });
module.exports = mongoose.model('TestState', schema);
