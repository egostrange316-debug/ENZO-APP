const mongoose = require('mongoose');
// "Husanboy bilan English" (Kids 200 kun) progressi: o'quvchiga bitta hujjat.
// Holat JSON matn sifatida saqlanadi (kalitlarda nuqta bo'lishi mumkin: "Mr.|janob").
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  data: { type: String, default: '{}' },
  done: { type: Number, default: 0 }, // tugatilgan kunlar soni
  day: { type: Number, default: 1 }, // hozirgi (birinchi tugatilmagan) kun
}, { timestamps: true });
module.exports = mongoose.model('KidsState', schema);
