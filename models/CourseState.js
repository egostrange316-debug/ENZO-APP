const mongoose = require('mongoose');

/**
 * 450 kunlik Enzo Academy kursi: o'quvchi progressi (telefondan sinxronlanadi).
 * `state` — ilovadagi holat (S) o'zi: kunlar, bosqichlar, ballar. Server uni BIRLASHTIRADI (hech narsa yo'qolmaydi).
 * Qolgan maydonlar — jadval/reyting uchun tayyor xulosa.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    state: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    course_day: { type: Number, default: 0 }, // hozirgi kun (1..450)
    days_done: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    accuracy: { type: Number, default: null }, // oxirgi 14 ta tugagan kunning kun testi o'rtachasi, %
    week_points: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { "2026-W43": 17 }
    last_study_date: { type: String, default: '' },
    client_saved_at: { type: Date },
    // O'qituvchi belgilagan kun: { day, id, at }. Telefon qabul qilganini bildirguncha server shu kunni majburlaydi.
    override: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('CourseState', schema);
