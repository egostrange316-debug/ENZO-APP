/**
 * "Mashq" bo'limi (o'quvchi): qo'shimcha mashq. Hammasi AVTOMATIK va sun'iy intellektsiz:
 *  - xato qilingan savollar/so'zlar o'zi tushadi (lib/practiceLog.recordMistake, dars va takrorlashdan)
 *  - kunlik mashq (10 ta savol): avval xatolar, yetmasa o'tgan kunlardan so'z mashqlari
 *  - javob serverda tekshiriladi (to'g'ri javob ilovaga yuborilmaydi), cheksiz urinish
 *  - kuniga bir marta kam XP + streak (PracticeDay unikal indeksi qo'sh bosishdan himoya qiladi)
 * Savol matni va to'g'ri javob har doim kontentdan (itemsForDay) olinadi — bu yerda nusxasi saqlanmaydi.
 */
const User = require('../models/User');
const BookMaterial = require('../models/BookMaterial');
const PracticeItem = require('../models/PracticeItem');
const PracticeDay = require('../models/PracticeDay');
const ex = require('../services/exerciseService');
const game = require('../services/gameService');
const { itemsForDay } = require('./studentController');
const { CLEAR_STREAK } = require('../lib/practiceLog');

const SESSION_SIZE = Math.max(3, Number(process.env.PRACTICE_SESSION_SIZE) || 10);
const PRACTICE_XP = Math.max(0, Number(process.env.PRACTICE_XP) || 5);
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('practiceController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const addDays = (key, n) => new Date(new Date(key + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

/** day -> {itemsByKey} (bir so'rovda bir kun bir marta o'qiladi) */
function dayCache() {
  const m = new Map();
  return async (day) => {
    if (!m.has(day)) {
      const items = await itemsForDay(day);
      m.set(day, new Map(items.map((i) => [i.key, i])));
    }
    return m.get(day);
  };
}

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const publicOut = (item, day) => ({ ...ex.publicItem(item, null), day_number: day });

/** GET /practice — bosh ekran: maqsad, streak, hisoblagichlar */
const summary = wrap(async (req, res) => {
  const u = req.user;
  const today = game.dateKey();
  const from = addDays(today, -6);
  const [days, active, books, practicedToday] = await Promise.all([
    PracticeDay.find({ user: u._id, date: { $gte: from } }).select('date').lean(),
    PracticeItem.find({ user: u._id, status: 'active' }).select('day_number key').lean(),
    BookMaterial.find({ assigned_day: { $lte: u.current_day, $ne: null }, status: 'ready' }).select('writing.vocabulary').lean(),
    PracticeDay.exists({ user: u._id, date: today }),
  ]);
  const set = new Set(days.map((d) => d.date));
  const week = Array.from({ length: 7 }, (_, i) => { const date = addDays(from, i); return { date, done: set.has(date) }; });
  // Streak ko'rsatilganda: kecha ham bugun ham faol bo'lmasa — uzilgan
  const last = u.last_study_date;
  const streak = last && dayDiff(last, today) <= 1 ? u.streak || 0 : 0;
  res.status(200).json({
    today: { date: today, practiced: !!practicedToday, size: SESSION_SIZE, xp: PRACTICE_XP },
    streak: { current: streak, best: u.best_streak || 0 },
    week,
    counts: {
      words: books.reduce((n, b) => n + (b.writing?.vocabulary || []).length, 0),
      mistakes: active.length,
      hard_words: active.filter((a) => /^b[0-9a-f]{6}:[vw]:\d+$/.test(a.key)).length,
    },
  });
});

/** GET /practice/words?limit=&offset= — ochilgan kunlardagi hamma so'zlar; xato qilinganlari hard:true */
const words = wrap(async (req, res) => {
  const u = req.user;
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 150));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const [books, active] = await Promise.all([
    BookMaterial.find({ assigned_day: { $lte: u.current_day, $ne: null }, status: 'ready' }).select('assigned_day writing.vocabulary').sort({ assigned_day: -1 }).lean(),
    PracticeItem.find({ user: u._id, status: 'active', key: /^b[0-9a-f]{6}:[vw]:\d+$/ }).select('day_number key').lean(),
  ]);
  const hard = new Set(active.map((a) => `${a.day_number}:${a.key.split(':')[2]}`));
  const all = [];
  for (const b of books) {
    (b.writing?.vocabulary || []).forEach((v, i) => {
      if (!v.word) return;
      all.push({ word: v.word, translation_uz: v.translation_uz, example_sentence: v.example_sentence || '', day: b.assigned_day, hard: hard.has(`${b.assigned_day}:${i}`) });
    });
  }
  res.status(200).json({ total: all.length, words: all.slice(offset, offset + limit) });
});

/** GET /practice/mistakes — faol xatolar (savol matni bilan, javobsiz) */
const mistakes = wrap(async (req, res) => {
  const rows = await PracticeItem.find({ user: req.user._id, status: 'active' }).sort({ wrong_total: -1, last_at: 1 }).limit(100).lean();
  const get = dayCache();
  const out = [];
  for (const r of rows) {
    const item = (await get(r.day_number)).get(r.key);
    if (item) out.push({ day_number: r.day_number, key: r.key, section: item.section, question: item.question, wrong_total: r.wrong_total });
  }
  res.status(200).json({ mistakes: out });
});

/** GET /practice/session — bugungi mashq: avval xatolar, yetmasa o'tgan kunlardan so'z mashqlari */
const session = wrap(async (req, res) => {
  const u = req.user;
  const get = dayCache();
  const picked = new Map(); // `${day}:${key}` -> publicItem
  const rows = await PracticeItem.find({ user: u._id, status: 'active', day_number: { $lte: u.current_day } })
    .sort({ wrong_total: -1, last_at: 1 }).limit(SESSION_SIZE).lean();
  let fromMistakes = 0;
  for (const r of rows) {
    const item = (await get(r.day_number)).get(r.key);
    if (!item) continue;
    picked.set(`${r.day_number}:${r.key}`, publicOut(item, r.day_number));
    fromMistakes += 1;
  }
  if (picked.size < SESSION_SIZE && u.current_day >= 1) {
    // To'ldirish: o'tgan kunlardan tasodifiy so'z mashqlari (lug'at bo'limi) — bola doim nimadir mashq qilsin
    const pool = shuffle(Array.from({ length: u.current_day }, (_, i) => i + 1)).slice(0, 6);
    for (const day of pool) {
      if (picked.size >= SESSION_SIZE) break;
      const items = [...(await get(day)).values()].filter((i) => i.section === 'vocab');
      for (const item of shuffle(items).slice(0, 2)) {
        const k = `${day}:${item.key}`;
        if (!picked.has(k) && picked.size < SESSION_SIZE) picked.set(k, publicOut(item, day));
      }
    }
  }
  res.status(200).json({ items: shuffle([...picked.values()]), from_mistakes: fromMistakes, size: SESSION_SIZE });
});

/** POST /practice/answer { day_number, key, answer } — serverda tekshiriladi, holat yangilanadi */
const answer = wrap(async (req, res) => {
  const u = req.user;
  const day = Number(req.body.day_number);
  const key = String(req.body.key || '');
  if (!Number.isInteger(day) || day < 1 || day > u.current_day) return res.status(400).json({ message: "Kun raqami noto'g'ri" });
  const item = (await dayCache()(day)).get(key);
  if (!item) return res.status(404).json({ message: 'Savol topilmadi' });
  const correct = ex.isCorrect(item, req.body.answer);
  const filter = { user: u._id, day_number: day, key };
  if (correct) {
    const cur = await PracticeItem.findOne(filter).lean();
    if (cur && cur.status === 'active') {
      const streak = (cur.streak || 0) + 1;
      const done = streak >= CLEAR_STREAK;
      await PracticeItem.updateOne(filter, { $set: { streak, last_at: new Date(), ...(done ? { status: 'done', done_at: new Date() } : {}) } });
      return res.status(200).json({ correct, streak, cleared: done, need: CLEAR_STREAK });
    }
    return res.status(200).json({ correct });
  }
  await PracticeItem.updateOne(filter,
    { $set: { status: 'active', streak: 0, last_at: new Date() }, $unset: { done_at: '' }, $inc: { wrong_total: 1 }, $setOnInsert: { added_at: new Date() } },
    { upsert: true }).catch((e) => { if (!(e && e.code === 11000)) throw e; });
  res.status(200).json({ correct, reveal: ex.feedbackFor(item, ex.REVEAL_AFTER).reveal });
});

/** POST /practice/complete — bugungi mashq tugadi: XP (kuniga bir marta) + streak */
const complete = wrap(async (req, res) => {
  const u = req.user;
  const today = game.dateKey();
  let first = false;
  try { await PracticeDay.create({ user: u._id, date: today, xp: PRACTICE_XP }); first = true; }
  catch (e) { if (!(e && e.code === 11000)) throw e; }
  let streak = u.streak || 0; let xp = 0;
  if (first) {
    const st = await game.touchStreak(u._id);
    streak = st.streak;
    if (PRACTICE_XP > 0) { await game.addXp(u._id, PRACTICE_XP); xp = PRACTICE_XP; }
  }
  res.status(200).json({ first_today: first, xp, streak });
});

module.exports = { summary, words, mistakes, session, answer, complete, SESSION_SIZE };
