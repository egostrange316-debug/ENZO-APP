const mongoose = require('mongoose');

/** Guruh uchun uy vazifasi. O'z vaqtida topshirsa reward_ball beriladi, topshirmasa muddatdan keyin penalty_ball ayriladi (bir martalik). */
const schema = new mongoose.Schema(
  {
    group_name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    starts_at: { type: Date, required: true },
    ends_at: { type: Date, required: true },
    reward_ball: { type: Number, default: 0, min: 0 },
    penalty_ball: { type: Number, default: 0, min: 0 },
    settled_at: { type: Date }, // muddat o'tgach jarimalar hisoblangan vaqt
  },
  { timestamps: true }
);
schema.index({ group_name: 1, ends_at: -1 });

module.exports = mongoose.model('Homework', schema);
