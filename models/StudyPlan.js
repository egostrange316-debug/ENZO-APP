const mongoose = require('mongoose');
const { LEVELS, TOTAL_DAYS, levelForDay, deriveLessonType } = require('../config/curriculum');

const vocabularyItemSchema = new mongoose.Schema(
  {
    word: { type: String, required: true },
    translation_uz: { type: String, required: true },
    example_sentence: { type: String, default: '' },
    pronunciation_hint: { type: String, default: '' }, // eski ilovadagi lat_word
  },
  { _id: false }
);

const quizItemSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: {
      type: [String],
      validate: { validator: (a) => a.length >= 2, message: "Kamida 2 ta variant bo'lishi kerak" },
    },
    correct_answer_index: { type: Number, required: true },
  },
  { _id: false }
);

const fillInTheBlankItemSchema = new mongoose.Schema(
  {
    sentence_with_blank: { type: String, required: true }, // "She ___ to school."
    correct_word: { type: String, required: true },
    options: { type: [String], default: [] }, // ixtiyoriy: tayyor variantlar (bo'sh bo'lsa, bola yozib kiritadi)
  },
  { _id: false }
);

const speakingQuestionSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    question_text: { type: String, required: true },
    hint_words: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * StudyPlan — 646 kunlik reja. day_number GLOBAL (1..646) va noyob.
 * level va lesson_type kun raqamidan avtomatik hisoblanadi (validatsiyadan oldin),
 * shuning uchun ular hech qachon bir-biriga zid bo'lib qolmaydi.
 */
const studyPlanSchema = new mongoose.Schema(
  {
    day_number: { type: Number, required: true, unique: true, min: 1, max: TOTAL_DAYS },
    level: { type: String, enum: LEVELS },
    unit_title: { type: String, required: true },
    lesson_type: { type: String, enum: ['regular', 'mini_check', 'mid_check', 'final_exam'] },

    vocabulary: { type: [vocabularyItemSchema], default: [] },
    quizzes: { type: [quizItemSchema], default: [] },
    fill_in_the_blanks: { type: [fillInTheBlankItemSchema], default: [] },
    speaking_questions: { type: [speakingQuestionSchema], default: [] },

    // Migratsiya izi: qaysi eski Supabase vocab_files qatoridan kelgan (qayta ishga tushirish xavfsiz bo'lishi uchun)
    legacy_file_id: { type: String }, // default YO'Q (unique sparse)
    // true bo'lsa — kun joyi band, lekin kontent hali kiritilmagan (masalan final_exam uchun Speaking savollari)
    needs_content: { type: Boolean, default: false },
  },
  { timestamps: true }
);

studyPlanSchema.index({ legacy_file_id: 1 }, { unique: true, sparse: true });

studyPlanSchema.pre('validate', function (next) {
  if (this.day_number) {
    this.level = levelForDay(this.day_number);
    this.lesson_type = deriveLessonType(this.day_number);
  }
  next();
});

// findOneAndUpdate(upsert) pre('validate') ni ishga tushirmaydi — shuning uchun shu yerda ham hisoblaymiz.
studyPlanSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;
  const day = set.day_number ?? this.getQuery().day_number;
  if (day) {
    set.level = levelForDay(day);
    set.lesson_type = deriveLessonType(day);
    if (!update.$set) this.setUpdate(set);
  }
  next();
});

module.exports = mongoose.model('StudyPlan', studyPlanSchema);
