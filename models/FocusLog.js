const mongoose = require('mongoose');

const appUsageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    pkg: { type: String, default: '', trim: true, maxlength: 120 },
    minutes: { type: Number, default: 0, min: 0, max: 1440 },
    kind: { type: String, enum: ['game', 'app'], default: 'app' },
  },
  { _id: false }
);

/** O'quvchining kunlik diqqat, o'yinlar va boshqa ilovalar statistikasi (Toshkent kuni 'YYYY-MM-DD'). */
const focusLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    study_minutes: { type: Number, default: 0, min: 0, max: 1440 },
    games_minutes: { type: Number, default: 0, min: 0, max: 1440 },
    other_apps_minutes: { type: Number, default: 0, min: 0, max: 1440 },
    total_distract_minutes: { type: Number, default: 0, min: 0, max: 1440 },
    left_count: { type: Number, default: 0, min: 0, max: 500 },
    usage_access: { type: Boolean, default: false },
    top_games: { type: [appUsageSchema], default: [] },
    top_apps: { type: [appUsageSchema], default: [] },
    all_top: { type: [appUsageSchema], default: [] },
    focus_score: { type: Number, default: 100, min: 0, max: 100 },
    pending_praise: { type: Number, default: 0, min: 0, max: 20 },
  },
  { timestamps: true }
);

focusLogSchema.index({ user: 1, date: 1 }, { unique: true });
focusLogSchema.index({ date: 1 });

module.exports = mongoose.model('FocusLog', focusLogSchema);
