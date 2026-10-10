const mongoose = require('mongoose');

/**
 * Har bir mini_check / mid_check / final_exam urinishini saqlab boradi.
 * Bu jadval o'quvchi tarixini ko'rish va Admin panelda tekshirish uchun kerak bo'ladi.
 */
const examAttemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    study_plan_day: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyPlan' }, // reja hali kiritilmagan bo'lsa bo'sh qolishi mumkin
    day_number: { type: Number, required: true },
    lesson_type: {
      type: String,
      enum: ['mini_check', 'mid_check', 'final_exam'],
      required: true,
    },
    attempt_number: { type: Number }, // mini/mid: shu kun uchun nechanchi urinish (1, 2, 3 ...). final_exam uchun bo'sh
    correct_count: { type: Number },
    total_count: { type: Number },
    // Yiqilganda: qaysi savollarda xato qilgan (mini-mashq shu savollardan tuziladi)
    wrong_keys: { type: [String], default: [] },
    score_percent: { type: Number, min: 0, max: 100 }, // final_exam (speaking) uchun bo'sh qolishi mumkin
    passed: { type: Boolean, required: true },
    // final_exam kunlari uchun: admin offline speaking imtihonini tasdiqlaganmi
    speaking_approved_by_admin: { type: Boolean, default: false },
    speaking_approved_at: { type: Date },
    speaking_approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Qo'sh bosishda bir xil urinish ikki marta yozilmasin (final_exam yozuvlarida attempt_number yo'q — sparse)
examAttemptSchema.index({ user: 1, day_number: 1, attempt_number: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ExamAttempt', examAttemptSchema);
