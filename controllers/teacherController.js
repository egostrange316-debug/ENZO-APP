/**
 * O'qituvchi uchun: "bugungi mavzu" paneli (o'quvchilar qaysi kunda, kitobning qaysi joyida) va tarjimani tahrirlash.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const BookMaterial = require('../models/BookMaterial');
const DayMastery = require('../models/DayMastery');
const { TOTAL_DAYS, LEVEL_LABELS, levelForDay, deriveLessonType, LEVELS, levelRange } = require('../config/curriculum');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('teacherController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

/**
 * GET /api/admin/today[?group=1-guruh]
 * Faol o'quvchilar joriy kuni bo'yicha guruhlanadi. Har guruh uchun: kun, daraja, dars turi, mavzu,
 * kitobdagi joyi ("Key Words ..., 12-bet"), grammatika mavzusi va o'quvchilar ro'yxati.
 */
const todayPanel = wrap(async (req, res) => {
  const filter = { role: 'student' };
  if (req.query.group) filter.group_name = String(req.query.group);
  const students = await User.find(filter).select('full_name group_name current_day status').sort({ full_name: 1 }).lean();
  const days = [...new Set(students.filter((s) => s.current_day <= TOTAL_DAYS).map((s) => s.current_day))];
  const [plans, books] = await Promise.all([
    StudyPlan.find({ day_number: { $in: days } }).select('day_number unit_title').lean(),
    BookMaterial.find({ assigned_day: { $in: days }, status: 'ready' }).select('assigned_day title book_ref writing.grammar.title writing.grammar.title_uz writing.grammar.explanation_uz').lean(),
  ]);
  // Qaysi o'quvchi joriy mavzuni qayta o'tmoqda (o'zlashtirmagan) — o'qituvchi ko'rib turishi uchun
  const retries = await DayMastery.find({ user: { $in: students.map((s) => s._id) }, mastered: false, passes: { $gt: 0 } }).lean();
  const retryBy = new Map(retries.map((m) => [`${m.user}|${m.day_number}`, m]));
  const planBy = new Map(plans.map((p) => [p.day_number, p]));
  const bookBy = new Map(books.map((b) => [b.assigned_day, b]));
  const groups = new Map();
  let finished = 0;
  for (const s of students) {
    if (s.current_day > TOTAL_DAYS) { finished++; continue; }
    const key = `${s.group_name || ''}|${s.current_day}`;
    if (!groups.has(key)) {
      const b = bookBy.get(s.current_day);
      const card = (b?.writing?.grammar || []).find((g) => g.explanation_uz);
      groups.set(key, {
        group_name: s.group_name || null,
        day: s.current_day,
        level: levelForDay(s.current_day),
        level_label: LEVEL_LABELS[levelForDay(s.current_day)],
        lesson_type: deriveLessonType(s.current_day),
        unit_title: planBy.get(s.current_day)?.unit_title || null,
        book_ref: b?.book_ref?.label ? b.book_ref : null,
        book_id: b?._id || null,
        grammar: card ? { title: card.title, title_uz: card.title_uz } : null,
        students: [],
      });
    }
    const rm = retryBy.get(`${s._id}|${s.current_day}`);
    groups.get(key).students.push({ id: s._id, full_name: s.full_name, blocked: s.status === 'blocked', retry: !!rm, retry_passes: rm?.passes || 0, last_percent: rm?.last_percent ?? null, needs_teacher: !!rm?.needs_teacher });
  }
  const list = [...groups.values()].sort((a, b) => (a.group_name || '').localeCompare(b.group_name || '') || a.day - b.day);
  // Daraja tablari uchun: har darajada nechta o'quvchi bor
  const levelCounts = LEVELS.map((l) => ({ level: l, label: LEVEL_LABELS[l], ...levelRange(l), students: list.filter((g) => g.level === l).reduce((n, g) => n + g.students.length, 0) }));
  res.status(200).json({ groups: list, levels: levelCounts, finished });
});

/** GET /api/admin/books/:id/content — tahrirlash uchun lug'at (indeks bilan) */
const vocabOf = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "To'plam topilmadi" });
  const b = await BookMaterial.findById(req.params.id).select('title book_ref assigned_day teacher_edited writing.vocabulary').lean();
  if (!b) return res.status(404).json({ message: "To'plam topilmadi" });
  res.status(200).json({ id: b._id, title: b.title, book_ref: b.book_ref || null, day: b.assigned_day, teacher_edited: !!b.teacher_edited, vocabulary: b.writing?.vocabulary || [] });
});

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/**
 * PATCH /api/admin/books/:id/vocab   { edits: [{ index, translation_uz?, example_sentence? }] }
 * Tarjima/misolni tuzatadi. Inglizcha so'z o'zgarmaydi (mashq kalitlari bilan bog'liq).
 * To'plam `teacher_edited` bo'ladi: seedAll qayta ishga tushsa ham tuzatishlar saqlanadi.
 */
const editVocab = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "To'plam topilmadi" });
  const b = await BookMaterial.findById(req.params.id);
  if (!b) return res.status(404).json({ message: "To'plam topilmadi" });
  const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
  if (!edits.length || edits.length > 100) return res.status(400).json({ message: "edits: 1 dan 100 gacha o'zgartirish bo'lishi kerak" });
  const vocab = b.writing.vocabulary;
  const seen = new Set(vocab.map((v) => clean(v.translation_uz, 200).toLowerCase()));
  for (const e of edits) {
    const i = Number(e.index);
    if (!Number.isInteger(i) || i < 0 || i >= vocab.length) return res.status(400).json({ message: `Noto'g'ri indeks: ${e.index}` });
    if (e.translation_uz !== undefined) {
      const t = clean(e.translation_uz, 200);
      if (t.length < 1) return res.status(400).json({ message: "Tarjima bo'sh bo'lmasin" });
      if (/[Ѐ-ӿ]/.test(t)) return res.status(400).json({ message: 'Tarjimani lotin harflarida yozing' });
      const old = clean(vocab[i].translation_uz, 200).toLowerCase();
      if (t.toLowerCase() !== old && seen.has(t.toLowerCase())) return res.status(409).json({ message: `"${t}" tarjimasi shu kunda boshqa so'zda bor` });
      seen.delete(old); seen.add(t.toLowerCase());
      vocab[i].translation_uz = t;
    }
    if (e.example_sentence !== undefined) vocab[i].example_sentence = clean(e.example_sentence, 300);
  }
  b.teacher_edited = true;
  b.markModified('writing.vocabulary');
  await b.save();
  res.status(200).json({ ok: true, vocabulary: b.writing.vocabulary });
});

module.exports = { todayPanel, vocabOf, editVocab };
