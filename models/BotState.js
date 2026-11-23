const mongoose = require('mongoose');
// Telegram suhbat holati (ota-ona ism yoki sabab yozayotgan paytda). 2 soatdan keyin o'zi o'chadi.
const schema = new mongoose.Schema({
  chat_id: { type: String, required: true, unique: true },
  step: { type: String, default: '' },
  tries: { type: Number, default: 0 },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now, expires: 7200 },
});
module.exports = mongoose.model('BotState', schema);
