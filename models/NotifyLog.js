const mongoose = require('mongoose');
// Bir xabar ikki marta ketmasligi uchun: key noyob. 40 kundan keyin o'zi o'chadi.
const schema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, at: { type: Date, default: Date.now, expires: 40 * 86400 } });
module.exports = mongoose.model('NotifyLog', schema);
