/**
 * Imtihon kunlari (mini_check / mid_check / final_exam) uchun savollarni tayyor kontentdan yig'adi.
 * AI ishlatilmaydi. Savollar faqat imtihon qamrab olgan kunlarning o'zida o'tilgan so'z va grammatikadan olinadi,
 * shuning uchun imtihon har doim kitob/dars tartibiga mos keladi. Tanlash deterministik (kun raqamidan).
 *
 *  - mini_check : 5 so'z (EN->UZ) + 3 grammatika (tanlash) + 4 gap to'ldirish   (oxirgi bo'limdagi kunlardan)
 *  - mid_check  : 8 so'z + 4 grammatika + 6 gap to'ldirish                      (oxirgi 4 bo'limdagi kunlardan)
 *  - final_exam : faqat Speaking — darajaning hamma kunlaridan teng oraliqda 8 ta savol
 */
const BookMaterial = require('../models/BookMaterial');
const StudyPlan = require('../models/StudyPlan');
const { LEVELS, LEVEL_LABELS, LEVEL_RANGES, deriveLessonType, examCoverage } = require('../config/curriculum');

function rng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seed) {
  const r = rng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const lc = (s) => String(s).trim().toLowerCase();

/** Qamrab olingan kunlar: mini = oldingi imtihondan beri; mid = oxirgi 4 ta bo'lim (oldingi mid_check gacha). */
function coverageDays(day) {
  const type = deriveLessonType(day);
  const base = examCoverage(day);
  if (type !== 'mid_check') return base;
  // oldingi mid_check yoki daraja boshigacha bo'lgan hamma dars kunlari
  const level = LEVELS.find((l) => day <= LEVEL_RANGES[l].to);
  const from = LEVEL_RANGES[level].from;
  const out = [];
  for (let d = day - 1; d >= from; d--) {
    const t = deriveLessonType(d);
    if (t === 'mid_check') break;
    if (t === 'regular') out.unshift(d);
  }
  return out;
}

function pickDistinct(items, n, seed, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of shuffled(items, seed)) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length === n) break;
  }
  return out;
}

async function examContent(day) {
  const type = deriveLessonType(day);
  const days = coverageDays(day);
  const books = await BookMaterial.find({ assigned_day: { $in: days }, status: 'ready' }).lean();
  const vocab = [];
  const gaps = [];
  const grammar = [];
  for (const b of books) {
    for (const v of b.writing?.vocabulary || []) if (v.word && v.translation_uz) vocab.push(v);
    (b.writing?.grammar || []).forEach((g, gi) => {
      for (const e of g.exercises || []) {
        if (!e.options || e.options.length < 3) continue;
        // 0-guruh = grammatika kartasi; qolgani lug'at gaplari
        if (g.explanation_uz && (g.forms || []).length) grammar.push(e); else gaps.push(e);
      }
    });
  }
  const nV = type === 'mid_check' ? 8 : 5;
  const nG = type === 'mid_check' ? 4 : 3;
  const nF = type === 'mid_check' ? 6 : 4;
  const seed = `exam:${day}`;

  const vocabPick = pickDistinct(vocab, nV, seed + ':v', (v) => lc(v.translation_uz));
  const quizzes = vocabPick.map((v, i) => {
    const wrong = pickDistinct(vocab.filter((x) => lc(x.translation_uz) !== lc(v.translation_uz)), 3, `${seed}:w${i}`, (x) => lc(x.translation_uz));
    const options = shuffled([v.translation_uz, ...wrong.map((w) => w.translation_uz)], `${seed}:o${i}`);
    return { question: `"${v.word}" so'zining tarjimasi qaysi?`, options, correct_answer_index: options.indexOf(v.translation_uz) };
  });
  pickDistinct(grammar, nG, seed + ':g', (e) => lc(e.sentence_with_blank)).forEach((e, i) => {
    const options = shuffled(e.options, `${seed}:go${i}`);
    quizzes.push({ question: `To'g'ri so'zni tanlang: ${e.sentence_with_blank}`, options, correct_answer_index: options.findIndex((o) => lc(o) === lc(e.correct_word)) });
  });
  const fill = pickDistinct(gaps, nF, seed + ':f', (e) => lc(e.sentence_with_blank)).map((e) => ({
    sentence_with_blank: e.sentence_with_blank, correct_word: e.correct_word, options: shuffled(e.options, seed + ':fo' + e.correct_word),
  }));
  return { days, quizzes: shuffled(quizzes, seed + ':q').filter((q) => q.correct_answer_index >= 0), fill };
}

async function finalSpeaking(level) {
  const { from, to } = LEVEL_RANGES[level];
  const books = await BookMaterial.find({ assigned_day: { $gte: from, $lte: to }, status: 'ready' }).sort({ assigned_day: 1 }).select('speaking assigned_day').lean();
  const withQ = books.filter((b) => (b.speaking?.questions || []).length);
  const n = Math.min(8, withQ.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = withQ[Math.floor((i * withQ.length) / n)];
    const qs = b.speaking.questions;
    const q = qs[(i * 7 + 1) % qs.length];
    out.push({ topic: q.topic, question_text: q.question_text, hint_words: q.hint_words || [] });
  }
  return out;
}

/** Barcha imtihon kunlari uchun StudyPlan hujjatlarini yaratadi/yangilaydi. Qaytaradi: { mini, mid, final } sonlari. */
async function buildExams(log = () => {}) {
  const res = { mini: 0, mid: 0, final: 0, empty: 0 };
  for (const level of LEVELS) {
    const { from, to } = LEVEL_RANGES[level];
    let n = 0;
    for (let d = from; d <= to; d++) {
      const type = deriveLessonType(d);
      if (type === 'regular') continue;
      n++;
      if (type === 'final_exam') {
        const speaking = await finalSpeaking(level);
        await StudyPlan.findOneAndUpdate(
          { day_number: d },
          { $set: { day_number: d, unit_title: `${LEVEL_LABELS[level]} — yakuniy Speaking imtihoni`, vocabulary: [], quizzes: [], fill_in_the_blanks: [], speaking_questions: speaking, needs_content: speaking.length === 0 } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.final++;
        if (!speaking.length) res.empty++;
        continue;
      }
      const c = await examContent(d);
      if (!c.quizzes.length) res.empty++;
      const first = c.days[0];
      const last = c.days[c.days.length - 1];
      await StudyPlan.findOneAndUpdate(
        { day_number: d },
        { $set: { day_number: d, unit_title: `${LEVEL_LABELS[level]} — ${n}-imtihon (${first}–${last}-kunlar)`, vocabulary: [], quizzes: c.quizzes, fill_in_the_blanks: c.fill, speaking_questions: [], needs_content: c.quizzes.length === 0 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (type === 'mid_check') res.mid++; else res.mini++;
    }
    log(`${level}: ${n} ta imtihon kuni tayyor`);
  }
  return res;
}

module.exports = { buildExams, examContent, coverageDays };
