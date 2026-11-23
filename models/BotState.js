const mongoose = require('mongoose');
// Telegram suhbat holati (ota-ona ism yozayotgan paytda). 2 soatdan keyin o'zi o'chadi.
const schema = new mongoose.Schema({
  chat_id: { type: String, required: true, unique: true },
  step: { type: String, default: '' },
  tries: { type: Number, default: 0 },
  at: { type: Date, default: Date.now, expires: 7200 },
});
module.exports = mongoose.model('BotState', schema);
