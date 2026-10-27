/**
 * Kurs jadvali (450 kun, A1–C1) va naqd to'lovlar jadvali — ilovaning doimiy qismi.
 *  - GET /api/student/schedule : o'quvchi uchun kurs jadvali (to'lov ma'lumoti YO'Q)
 *  - GET /api/admin/schedule   : o'qituvchi uchun xuddi shu jadval + har kunda nechta o'quvchi turgani
 *  - GET /api/admin/payments   : faqat o'qituvchi: naqd to'lovlar jadvali
 */
const User = require('../models/User');
const { subscriptionInfo } = require('../lib/subscription');
const C = require('../lib/course450');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('scheduleController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

function buildSchedule() {
  const days = C.DAYS.map((x) => {
    const i = C.describeDay(x.d);
    return {
      day: x.d, level: C.LEVEL_ID[x.l], level_label: x.l, type: i.type, week: x.w, week_title: x.wt,
      title: i.title, book: null, book_ref: i.book_ref, grammar: x.g, vocab: x.v, reading: x.r, listening: x.a, writing: x.x,
      words: 0, ready: true,
    };
  });
  const levels = C.LEVELS.map((l) => {
    const { from, to } = C.LEVEL_RANGES[l];
    const slice = days.slice(from - 1, to);
    return {
      level: C.LEVEL_ID[l], label: l, from, to, total: slice.length,
      lessons: slice.filter((x) => x.type === 'regular').length,
      mini: slice.filter((x) => x.type === 'mini_check').length,
      mid: 0,
      final: slice.filter((x) => x.type === 'final_exam').length,
      book: null,
    };
  });
  return { total_days: C.TOTAL_DAYS, levels, days };
}

const studentSchedule = wrap(async (req, res) => {
  const s = buildSchedule();
  res.status(200).json({ ...s, current_day: C.studentDay(req.user) || C.TOTAL_DAYS });
});

const adminSchedule = wrap(async (req, res) => {
  const s = buildSchedule();
  const students = await User.find({ role: 'student' }).select('current_day course_day').lean();
  const count = new Map();
  for (const u of students) { const d = C.studentDay(u); if (d) count.set(d, (count.get(d) || 0) + 1); }
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
