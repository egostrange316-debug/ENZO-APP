const mongoose = require('mongoose');
const { LEVELS } = require('../config/curriculum');

const mcq = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: { type: [String], validate: { validator: (a) => a.length >= 2, message: 'Kamida 2 ta variant' } },
    correct_answer_index: { type: Number, required: true },
  },
  { _id: false }
);

const fillBlank = new mongoose.Schema(
  {
    sentence_with_blank: { type: String, required: true }, // "She ___ to school."
    correct_word: { type: String, required: true },
    options: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * Kitob (PDF/rasm) dan AI yordamida yaratilgan mashqlar to'plami.
 * 4 bo'lim: Writing (lug'at + grammatika), Reading (matn + kalit so'zlar + savollar),
 * Listening (matn — ilovadagi TTS o'qib beradi — + savollar + diktant), Speaking (majburiy savollar).
 */
const bookMaterialSchema = new mongoose.Schema(
  {
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    level_hint: { type: String, enum: [...LEVELS, null], default: null },

    // Qaysi kunga biriktirilgan (null = biriktirilmagan). Faqat oddiy (regular) kunlarga.
    assigned_day: { type: Number, default: null, index: true },

    // Tayyor (o'zimiz yozgan) kontentni bazaga yuklash skripti uchun barqaror kalit, masalan "eviu-elementary:u11"
    seed_key: { type: String, default: null, index: true, sparse: true },

    // O'qituvchi tarjima/misolni qo'lda tuzatgan bo'lsa true: qayta joylashda (seedAll) mazmun ustiga yozilmaydi
    teacher_edited: { type: Boolean, default: false },

    // Bugungi dars kitobning qaysi joyiga to'g'ri keladi: o'qituvchi/o'quvchi kitobni shu bo'yicha ochadi
    book_ref: {
      _id: false,
      book: String,   // "Key Words for Fluency: Pre-Intermediate"
      unit: Number,   // EVIU uchun unit raqami
      page: Number,   // Key Words uchun bet raqami
      part: Number,   // unit 2 kunga bo'lingan bo'lsa: 1 yoki 2
      parts: Number,  // jami qismlar (1 yoki 2)
      label: String,  // tayyor matn: "Key Words for Fluency: Pre-Intermediate, 10-bet"
    },

    // Katta kitobni bo'lib yuklashdan kelgan bo'lsa: qaysi reja, tartib raqami, bo'lim va PDF sahifalari
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'BookPlan', default: null, index: true },
    plan_order: { type: Number },
    section_title: { type: String },
    source_pages: { _id: false, from: Number, to: Number }, // KITOB sahifa raqamlari

    source_files: [
      { _id: false, original_name: String, mime_type: String, size_bytes: Number },
    ],

    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing', index: true },
    error_message: { type: String }, // o'qituvchiga ko'rsatiladigan tushunarli xabar
    error_detail: { type: String },  // texnik tafsilot (qisqartirilgan)
    warnings: { type: [String], default: [] }, // masalan "Grammatika topilmadi"
    ai_model: { type: String },
    started_at: { type: Date, default: Date.now },
    finished_at: { type: Date },

    writing: {
      vocabulary: [
        { _id: false, word: String, translation_uz: String, example_sentence: String },
      ],
      grammar: [
        {
          _id: false,
          title: String,
          title_uz: String,
          explanation_uz: String,
          forms: [String],
          examples: [String],
          mistakes: [{ _id: false, wrong: String, right: String, note_uz: String }],
          exercises: [fillBlank],
        },
      ],
    },
    reading: {
      title: String,
      text: String,
      key_words: [{ _id: false, word: String, translation_uz: String }],
      questions: [mcq],
    },
    listening: {
      title: String,
      script: String, // ilovadagi TTS shuni o'qib beradi (audio fayl yaratilmaydi)
      questions: [mcq],
      dictation_sentences: [String],
    },
    // Qo'shimcha o'qish matnlari (CEFR/IELTS uslubida, original); seed: lib/readingSeed.js
    readings: [
      {
        _id: false,
        title: String,
        cefr: String,
        text: String,
        key_words: [{ _id: false, word: String, translation_uz: String }],
        questions: [
          { _id: false, question: String, options: [String], correct_answer_index: Number, explanation: String },
        ],
        fill: [{ _id: false, sentence_with_blank: String, correct_word: String, accept: [String], explanation: String }],
      },
    ],
    // Tashqi ochiq manba (VOA Learning English) — tayyor audio + savollar; seed: lib/voaSeed.js
    voa: {
      title: String,
      audio_url: String, // ilova ichidagi fayl (masalan /audio/voa/l1.mp3)
      transcript: String,
      credit: String,
      source_url: String,
      questions: [mcq],
      dictation: [String], // eshitib yozish (qurilma ovozi o'qiydi)
      gaps: [{ _id: false, sentence_with_blank: String, correct_word: String }], // audioni eshitib bo'sh joyni yozish
      fill: [fillBlank], // dialogdan gap to'ldirish
      speaking: { _id: false, question_text: String, hint_words: [String] },
      writing: { _id: false, question: String, must_words: [String], min_words: Number },
    },
    speaking: {
      questions: [
        { _id: false, topic: String, question_text: String, hint_words: [String] },
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BookMaterial', bookMaterialSchema);
