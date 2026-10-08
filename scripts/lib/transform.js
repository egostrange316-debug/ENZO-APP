/**
 * Supabase -> MongoDB o'tkazishning sof (I/O siz) qismi. Test qilish oson bo'lishi uchun alohida.
 */
const { LEVELS, DAYS_PER_LEVEL, levelForDay, deriveLessonType } = require('../../config/curriculum');

// FARAZ (o'zgartirishingiz mumkin): eski guruhlar qaysi darajaga to'g'ri keladi.
// Fayl berish: node scripts/migrateFromSupabase.js --group-map groupmap.json
const DEFAULT_GROUP_TO_LEVEL = {
  '1-guruh': 'elementary',
  '2-guruh': 'intermediate',
  '3-guruh': 'upper-intermediate',
  '4-guruh': 'advanced',
  'Qizlar guruhi': 'elementary',
};

const MAX_QUIZ = 10;
const MAX_FILL = 10;

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** students qatori -> User hujjati (parol hash'i alohida beriladi) */
function mapStudent(row, { subDays = 30, now = new Date() } = {}) {
  return {
    legacy_id: row.id,
    full_name: String(row.full_name || '').trim(),
    group_name: row.group_name || null,
    avatar: row.avatar || null,
    ball: row.ball || 0,
    words_count: row.words_count || 0,
    role: 'student',
    status: row.blocked ? 'blocked' : 'active',
    current_day: 1,
    level: LEVELS[0],
    subscription_end_date: new Date(now.getTime() + subDays * 24 * 60 * 60 * 1000),
  };
}

/** Bitta fayl (so'zlar + AI mashqlari) -> StudyPlan kontenti */
function buildContent(file, words, aiRows, rng = Math.random) {
  const aiByWord = new Map(aiRows.map((r) => [r.word_id, r]));

  const vocabulary = words.map((w) => {
    const ai = aiByWord.get(w.id);
    return {
      word: w.en_word,
      translation_uz: w.uz_word,
      pronunciation_hint: w.lat_word || '',
      example_sentence: ai && ai.sentence && ai.sentence.includes('___') ? ai.sentence.replace('___', ai.answer) : '',
    };
  });

  const quizzes = shuffle(words, rng)
    .map((w) => {
      const others = shuffle(words.filter((x) => x.id !== w.id).map((x) => x.en_word), rng).slice(0, 3);
      const options = shuffle([w.en_word, ...others], rng);
      return { question: w.uz_word, options, correct_answer_index: options.indexOf(w.en_word) };
    })
    .filter((q) => q.options.length >= 2)
    .slice(0, MAX_QUIZ);

  const fill_in_the_blanks = shuffle(
    aiRows.filter((r) => r.sentence && r.sentence.includes('___') && r.answer),
    rng
  )
    .slice(0, MAX_FILL)
    .map((r) => ({ sentence_with_blank: r.sentence, correct_word: r.answer, options: Array.isArray(r.options) ? r.options : [] }));

  return { unit_title: file.title, vocabulary, quizzes, fill_in_the_blanks, legacy_file_id: file.id };
}

/**
 * Fayllarga kun raqami beradi.
 *  - Avval ko'chirilgan fayl o'z kunini saqlaydi (qayta ishga tushirish xavfsiz).
 *  - Yangilari daraja ichidagi bo'sh kunlarga created_at tartibida joylashadi.
 *  - Har darajaning 100-kuni (final_exam) band qilinmaydi — u yerga Speaking savollari kerak.
 *  - Band kunlar (boshqa reja) ustiga yozilmaydi.
 *
 * existingPlans: [{ day_number, legacy_file_id }]
 * Qaytaradi: { plans: [...], finalPlaceholders: [...], skipped: [{file, reason}], errors: [string] }
 */
function planMigration({ files, vocab, aiExercises, existingPlans, groupToLevel = DEFAULT_GROUP_TO_LEVEL, rng = Math.random }) {
  const occupied = new Set(existingPlans.map((p) => p.day_number));
  const byLegacy = new Map(existingPlans.filter((p) => p.legacy_file_id).map((p) => [p.legacy_file_id, p.day_number]));

  const plans = [];
  const skipped = [];
  const errors = [];

  const sorted = [...files].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const perLevel = Object.fromEntries(LEVELS.map((l) => [l, []]));

  for (const file of sorted) {
    if (byLegacy.has(file.id)) {
      skipped.push({ file: file.title, reason: `allaqachon ko'chirilgan (${byLegacy.get(file.id)}-kun)` });
      continue;
    }
    const level = groupToLevel[file.group_name];
    if (!level || !LEVELS.includes(level)) {
      skipped.push({ file: file.title, reason: `"${file.group_name}" guruhi uchun daraja belgilanmagan` });
      continue;
    }
    const words = vocab.filter((v) => v.file_id === file.id);
    if (words.length === 0) {
      skipped.push({ file: file.title, reason: "ichida so'z yo'q" });
      continue;
    }
    perLevel[level].push({ file, words });
  }

  for (const level of LEVELS) {
    const queue = perLevel[level];
    if (!queue.length) continue;
    const start = LEVELS.indexOf(level) * DAYS_PER_LEVEL + 1;
    const free = [];
    for (let d = start; d < start + DAYS_PER_LEVEL - 1; d++) { // oxirgi kun (final_exam) chiqarib tashlanadi
      if (!occupied.has(d)) free.push(d);
    }
    if (queue.length > free.length) {
      errors.push(`${level}: ${queue.length} ta fayl bor, lekin bo'sh kun faqat ${free.length} ta — ortiqchasi ko'chirilmadi`);
    }
    queue.slice(0, free.length).forEach(({ file, words }, i) => {
      const day = free[i];
      const aiRows = aiExercises.filter((r) => r.file_id === file.id);
      plans.push({
        day_number: day,
        level: levelForDay(day),
        lesson_type: deriveLessonType(day),
        needs_content: false,
        ...buildContent(file, words, aiRows, rng),
        speaking_questions: [],
      });
      occupied.add(day);
    });
  }

  // Har ishlatilgan daraja uchun final_exam o'rni (agar yo'q bo'lsa)
  const finalPlaceholders = [];
  for (const level of LEVELS) {
    if (!plans.some((p) => p.level === level)) continue;
    const finalDay = (LEVELS.indexOf(level) + 1) * DAYS_PER_LEVEL;
    if (occupied.has(finalDay)) continue;
    finalPlaceholders.push({
      day_number: finalDay,
      level,
      lesson_type: 'final_exam',
      unit_title: `${level} — yakuniy imtihon (Speaking savollarini admin paneldan qo'shing)`,
      needs_content: true,
      vocabulary: [], quizzes: [], fill_in_the_blanks: [], speaking_questions: [],
    });
    occupied.add(finalDay);
  }

  return { plans, finalPlaceholders, skipped, errors };
}

module.exports = { DEFAULT_GROUP_TO_LEVEL, mapStudent, buildContent, planMigration };
