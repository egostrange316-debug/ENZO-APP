/**
 * Tayyor (qo'lda yozilgan) kitob kontentini BookMaterial "ready" to'plamlari sifatida bazaga yuklash.
 * AI ishlatilmaydi. Kontent: content/<paket>/b*.json — har faylda unit'lar massivi.
 *
 * Idempotent: to'plamlar `seed_key` bo'yicha yangilanadi (qayta ishga tushirsa dublikat bo'lmaydi).
 */
const fs = require('fs');
const path = require('path');
const BookMaterial = require('../models/BookMaterial');
const StudyPlan = require('../models/StudyPlan');
const { regularDaysOfLevel } = require('../config/curriculum');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const GAP_TITLE = "Lug'at: gaplarni to'ldiring";
const GAP_EXPLAIN = "Gapdagi bo'sh joyga mos so'zni tanlang.";

// Paket -> kitob nomi va yo'naltiruvchi (unit yoki bet)
const PACK_META = {
  'eviu-elementary': { book: 'English Vocabulary in Use: Elementary', kind: 'unit' },
  'kw-preintermediate': { book: 'Key Words for Fluency: Pre-Intermediate', kind: 'page' },
  'kw-intermediate': { book: 'Key Words for Fluency: Intermediate', kind: 'page' },
  'kw-upperintermediate': { book: 'Key Words for Fluency: Upper-Intermediate', kind: 'page' },
};

/** "Bugun kitobda: ..." uchun ma'lumot */
function bookRef(pack, unit, part = 1, parts = 1) {
  const meta = PACK_META[pack];
  if (!meta) return undefined;
  if (meta.kind === 'page') {
    return { book: meta.book, page: unit.unit, part, parts, label: `${meta.book}, ${unit.unit}-bet` };
  }
  const p = parts > 1 ? ` (${part}-qism)` : '';
  return { book: meta.book, unit: unit.unit, part, parts, label: `${meta.book}, ${unit.unit}-unit${p}` };
}

function loadGrammar(level) {
  const f = path.join(CONTENT_DIR, 'grammar', `${level}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}

/** i-to'plam (0 dan) uchun grammatika kartasi: har mavzu 2 ta ketma-ket kunga, mashqlar ikkiga bo'linadi */
function grammarCard(topics, i) {
  const t = topics[Math.floor(i / 2)];
  if (!t) return null;
  const half = i % 2;
  return {
    title: t.title,
    title_uz: t.title_uz,
    explanation_uz: t.rule_uz,
    forms: t.forms,
    examples: t.examples.map((e) => `${e.en} — ${e.uz}`),
    mistakes: t.mistakes,
    exercises: t.exercises.slice(half * 3, half * 3 + 3),
  };
}

function loadUnits(pack) {
  const dir = path.join(CONTENT_DIR, pack);
  const files = fs.readdirSync(dir).filter((f) => /^b\d+\.json$/.test(f)).sort();
  const units = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  units.sort((a, b) => a.unit - b.unit);
  return units;
}

/** Bitta unit -> 1 ta (yoki split bo'lsa 2 ta) to'plam. */
function buildSets(unit, { pack, split = false } = {}) {
  const key = (suffix = '') => `${pack}:u${unit.unit}${suffix}`;
  const gap = (ex) => ({ title: GAP_TITLE, explanation_uz: GAP_EXPLAIN, examples: [], exercises: ex });
  const reading = { title: unit.reading.title, text: unit.reading.text, key_words: unit.reading.key_words, questions: unit.reading.questions };
  const listening = { title: unit.listening.title, script: unit.listening.script, questions: unit.listening.questions, dictation_sentences: unit.listening.dictation_sentences };
  if (!split) {
    return [{
      seed_key: key(), title: `${unit.unit}-unit: ${unit.title}`, section_title: unit.title,
      writing: { vocabulary: unit.vocabulary, grammar: [gap(unit.gapfill)] },
      reading, listening, speaking: { questions: unit.speaking }, book_ref: bookRef(pack, unit),
    }];
  }
  const half = Math.ceil(unit.vocabulary.length / 2);
  const g = Math.ceil(unit.gapfill.length / 2);
  return [
    {
      seed_key: key('a'), title: `${unit.unit}-unit: ${unit.title} (1-qism)`, section_title: unit.title,
      writing: { vocabulary: unit.vocabulary.slice(0, half), grammar: [gap(unit.gapfill.slice(0, g))] },
      reading, listening: { title: listening.title, script: '', questions: [], dictation_sentences: [] }, speaking: { questions: unit.speaking },
      book_ref: bookRef(pack, unit, 1, 2),
    },
    {
      seed_key: key('b'), title: `${unit.unit}-unit: ${unit.title} (2-qism)`, section_title: unit.title,
      writing: { vocabulary: unit.vocabulary.slice(half), grammar: [gap(unit.gapfill.slice(g))] },
      reading: { title: '', text: '', key_words: [], questions: [] }, listening, speaking: { questions: [] },
      book_ref: bookRef(pack, unit, 2, 2),
    },
  ];
}

/**
 * @param {object} o { pack, level, uploader (ObjectId), split }
 * Daraja kunlariga tartib bilan joylaydi: i-to'plam -> darajaning i-bo'sh oddiy kuni
 * (imtihon kunlari va boshqa (shu paketga kirmaydigan) to'plamlar band kunlari o'tkazib yuboriladi).
 */
async function seedPack({ pack, level, uploader, split = false, from = null, to = null, grammar = true }) {
  const units = loadUnits(pack).filter((u) => (from === null || u.unit >= from) && (to === null || u.unit <= to));
  const sets = units.flatMap((u) => buildSets(u, { pack, split }));
  const rx = new RegExp('^' + `${pack}:`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const occupiedDocs = await BookMaterial.find({ assigned_day: { $ne: null }, seed_key: { $not: rx } }).select('assigned_day').lean();
  const occupied = new Set(occupiedDocs.map((b) => b.assigned_day));
  const free = regularDaysOfLevel(level).filter((d) => !occupied.has(d));

  // Shu darajaga tegishli, lekin endi kerak bo'lmagan (split/oraliq o'zgargan) to'plamlarni olib tashlaymiz.
  // Boshqa daraja (shu paketdan) to'plamlariga tegmaymiz: level_hint bo'yicha.
  await BookMaterial.deleteMany({ seed_key: { $regex: rx, $nin: sets.map((s) => s.seed_key) }, level_hint: level });
  const topics = grammar ? loadGrammar(level) : [];

  const placed = [];
  let overflow = 0;
  for (const [i, s] of sets.entries()) {
    const day = free[i] ?? null;
    if (day === null) overflow++;
    const card = grammar ? grammarCard(topics, i) : null;
    if (card) s.writing.grammar = [card, ...s.writing.grammar];
    const edited = await BookMaterial.exists({ seed_key: s.seed_key, teacher_edited: true });
    const doc = edited
      ? await BookMaterial.findOneAndUpdate(
          { seed_key: s.seed_key },
          { $set: { assigned_day: day, plan_order: i + 1, level_hint: level, book_ref: s.book_ref } },
          { new: true }
        )
      : await BookMaterial.findOneAndUpdate(
      { seed_key: s.seed_key },
      {
        $set: {
          title: s.title, section_title: s.section_title, level_hint: level, uploaded_by: uploader, status: 'ready',
          writing: s.writing, reading: s.reading, listening: s.listening, speaking: s.speaking,
          assigned_day: day, plan_order: i + 1, warnings: [], ai_model: 'manual', finished_at: new Date(), book_ref: s.book_ref,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (day !== null) {
      if (!(await StudyPlan.exists({ day_number: day }))) await StudyPlan.create({ day_number: day, unit_title: doc.title });
      placed.push({ day, title: doc.title });
    }
  }
  return { sets: sets.length, placed, overflow, free_days: free.length };
}

module.exports = { loadUnits, loadGrammar, grammarCard, buildSets, seedPack, PACK_META };
