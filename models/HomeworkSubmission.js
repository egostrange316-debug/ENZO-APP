const mongoose = require('mongoose');

/** Bitta o'quvchining bitta vazifasi: (homework, user) noyob — jarima/mukofot ikki marta berilmasligi shu indeksga tayanadi. */
const schema = new mongoose.Schema(
  {
    homework: { type: mongoose.Schema.Types.ObjectId, ref: 'Homework', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submitted: { type: Boolean, default: false },
    image_url: { type: String, default: null },
    submitted_at: { type: Date },
    on_time: { type: Boolean, default: false },
  },
  { timestamps: true }
);
schema.index({ homework: 1, user: 1 }, { unique: true });
schema.index({ user: 1 });

module.exports = mongoose.model('HomeworkSubmission', schema);
