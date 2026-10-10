/**
 * Kurs jadvali (646 kun) va naqd to'lovlar jadvali — ilovaning doimiy qismi.
 *  - GET /api/student/schedule : o'quvchi uchun kurs jadvali (to'lov ma'lumoti YO'Q)
 *  - GET /api/admin/schedule   : o'qituvchi uchun xuddi shu jadval + har kunda nechta o'quvchi turgani
 *  - GET /api/admin/payments   : faqat o'qituvchi: naqd to'lovlar jadvali
 */
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const BookMaterial = require('../models/BookMaterial');
const { subscriptionInfo } = require('../lib/subscription');
const { TOTAL_DAYS, LEVELS, LEVEL_LABELS, LEVEL_RANGES, levelForDay, deriveLessonType, examCoverage } = require('../config/curriculum');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('scheduleController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

async function buildSchedule() {
  const [plans, books] = await Promise.all([
    StudyPlan.find().select('day_number unit_title').lean(),
    BookMaterial.find({ assigned_day: { $ne: null }, status: 'ready' })
      .select('assigned_day section_title book_ref writing.grammar.title writing.grammar.title_uz writing.grammar.explanation_uz writing.vocabulary').lean(),
  ]);
  const planBy = new Map(plans.map((p) => [p.day_number, p]));
  const bookBy = new Map(books.map((b) => [b.assigned_day, b]));
  const examNo = {};
  const days = [];
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const level = levelForDay(d);
    const type = deriveLessonType(d);
    const row = { day: d, level, level_label: LEVEL_LABELS[level], type, title: null, book: null, book_ref: null, grammar: null, words: 0, ready: false };
    if (type === 'regular') {
      const b = bookBy.get(d);
      if (b) {
        const g = (b.writing?.grammar || []).find((x) => x.explanation_uz);
        Object.assign(row, {
          title: b.section_title || planBy.get(d)?.unit_title || null,
          book: b.book_ref?.book || null,
          book_ref: b.book_ref?.label ? b.book_ref.label.replace(`${b.book_ref.book}, `, '') : null,
          grammar: g ? (g.title_uz ? `${g.title} — ${g.title_uz}` : g.title) : null,
          words: (b.writing?.vocabulary || []).length,
          ready: true,
        });
      }
    } else {
      examNo[level] = (examNo[level] || 0) + 1;
      const cov = examCoverage(d);
      row.title = type === 'final_exam' ? "Yakuniy Speaking imtihoni (o'qituvchi tasdiqlaydi)" : `${examNo[level]}-imtihon: ${cov[0]}–${cov[cov.length - 1]}-kunlar`;
      row.ready = !!planBy.get(d);
    }
    days.push(row);
  }
  const levels = LEVELS.map((l) => {
    const { from, to } = LEVEL_RANGES[l];
    const slice = days.slice(from - 1, to);
    return {
      level: l, label: LEVEL_LABELS[l], from, to, total: slice.length,
      lessons: slice.filter((x) => x.type === 'regular').length,
      mini: slice.filter((x) => x.type === 'mini_check').length,
      mid: slice.filter((x) => x.type === 'mid_check').length,
      final: slice.filter((x) => x.type === 'final_exam').length,
      book: slice.find((x) => x.book)?.book || null,
    };
  });
  return { total_days: TOTAL_DAYS, levels, days };
}

const studentSchedule = wrap(async (req, res) => {
  const s = await buildSchedule();
  res.status(200).json({ ...s, current_day: req.user.current_day });
});

const adminSchedule = wrap(async (req, res) => {
  const s = await buildSchedule();
  const students = await User.find({ role: 'student' }).select('current_day').lean();
  const count = new Map();
  for (const u of students) count.set(u.current_day, (count.get(u.current_day) || 0) + 1);
  for (const d of s.days) d.students_here = count.get(d.day) || 0;
  res.status(200).json(s);
});

/** Naqd to'lovlar jadvali: har o'quvchi uchun holat, oxirgi to'lov va tarix. Faqat o'qituvchi. */
const paymentsTable = wrap(async (req, res) => {
  const students = await User.find({ role: 'student' }).select('full_name group_name status subscription_end_date payments').sort({ full_name: 1 }).lean();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let collected = 0;
  const rows = students.map((u) => {
    const pays = (u.payments || []).slice().sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
    const last = pays[0] || null;
    const total = pays.reduce((n, p) => n + (p.amount || 0), 0);
    for (const p of pays) if (new Date(p.paid_at) >= monthStart) collected += p.amount || 0;
    const info = subscriptionInfo(u, now);
    return {
      id: u._id, full_name: u.full_name, group_name: u.group_name || null,
      state: info.state, end_date: info.end_date, days_left: info.days_left, grace_days_left: info.grace_days_left,
      last_payment: last ? { paid_at: last.paid_at, amount: last.amount ?? null, paid_through: last.paid_through, note: last.note || null } : null,
      total_paid: total,
      history: pays.map((p) => ({ paid_at: p.paid_at, amount: p.amount ?? null, paid_through: p.paid_through, note: p.note || null })),
    };
  });
  const count = (st) => rows.filter((r) => r.state === st).length;
  res.status(200).json({
    rows,
    summary: { paid: count('paid'), grace: count('grace'), blocked: count('blocked'), collected_this_month: collected, students: rows.length },
  });
});

module.exports = { studentSchedule, adminSchedule, paymentsTable, buildSchedule };
