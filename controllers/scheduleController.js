/**
 * Kurs jadvali (450 kun, A1–C1) va naqd to'lovlar jadvali — ilovaning doimiy qismi.
 *  - GET /api/student/schedule : o'quvchi uchun kurs jadvali (to'lov ma'lumoti YO'Q)
 *  - GET /api/admin/schedule   : o'qituvchi uchun xuddi shu jadval + har kunda nechta o'quvchi turgani
 *  - GET /api/admin/payments   : faqat o'qituvchi: naqd to'lovlar jadvali
 */
const User = require('../models/User');
const { subscriptionInfo, localParts, startOfLocal, nextDueDate, clampPayDay } = require('../lib/subscription');
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

/**
 * To'lovlar jadvali (faqat o'qituvchi): har o'quvchi uchun BITTA aniq holat.
 *  paid  = To'lagan (muddat 3 kundan ko'p)      soon = Tez orada (3 kun yoki kam qoldi)
 *  late  = To'lamagan (muddat o'tdi, muhlatda)   blocked = Bloklangan
 */
const paymentsTable = wrap(async (req, res) => {
  const students = await User.find({ role: 'student' })
    .select('full_name group_name status subscription_end_date payments pay_day monthly_fee').sort({ full_name: 1 }).lean();
  const now = new Date();
  const lp = localParts(now);
  const monthStart = startOfLocal(lp.y, lp.m, 1);
  let collected = 0;
  const rows = students.map((u) => {
    const all = (u.payments || []).slice().sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
    const live = all.filter((p) => !p.cancelled);
    const last = live[0] || null;
    const total = live.reduce((n, p) => n + (p.amount || 0), 0);
    for (const p of live) if (new Date(p.paid_at) >= monthStart) collected += p.amount || 0;
    const info = subscriptionInfo(u, now);
    const status = info.state === 'blocked' ? 'blocked' : info.state === 'grace' ? 'late' : info.days_left <= 3 ? 'soon' : 'paid';
    // oxirgi yozilgan to'lov (bekor qilinmagan) 24 soat ichida bo'lsa — bekor qilish mumkin
    const newest = live.filter((p) => p.pid).sort((a, b) => new Date(b.recorded_at || 0) - new Date(a.recorded_at || 0))[0];
    const canCancel = !!newest && now - new Date(newest.recorded_at || 0) <= 24 * 3600 * 1000;
    const h = (p) => ({ paid_at: p.paid_at, amount: p.amount ?? null, paid_through: p.paid_through, note: p.note || null, cancelled: !!p.cancelled });
    return {
      id: u._id, full_name: u.full_name, group_name: u.group_name || null,
      state: info.state, status, end_date: info.end_date, days_left: info.days_left, grace_days_left: info.grace_days_left,
      next_due: nextDueDate(info.end_date),
      pay_day: clampPayDay(u.pay_day), monthly_fee: u.monthly_fee ?? null,
      last_payment: last ? { paid_at: last.paid_at, amount: last.amount ?? null, paid_through: last.paid_through, note: last.note || null } : null,
      can_cancel: canCancel,
      total_paid: total,
      history: all.map(h),
    };
  });
  const count = (st) => rows.filter((r) => r.status === st).length;
  res.status(200).json({
    rows,
    summary: {
      paid: count('paid'), soon: count('soon'), late: count('late'), blocked: count('blocked'),
      grace: count('late'), // eski ekranlar uchun
      collected_this_month: collected, students: rows.length,
    },
  });
});

module.exports = { studentSchedule, adminSchedule, paymentsTable, buildSchedule };
