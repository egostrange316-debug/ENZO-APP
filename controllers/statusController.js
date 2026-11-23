/**
 * Kunlik vazifa holati ("qizil jadval") — faqat o'qituvchi.
 *  GET   /api/admin/status                 : bugungi holat, guruhlar bo'yicha
 *  PATCH /api/admin/groups/:id/schedule    : { lesson_days:[1..7], deadline_hour:8..23 }
 *  POST  /api/admin/groups/:id/off         : { date?, off:true|false } — "bugun dars yo'q"
 *  POST  /api/admin/students/:id/excuse    : { date?, on:true|false }  — sababli
 */
const mongoose = require('mongoose');
const Group = require('../models/Group');
const User = require('../models/User');
const CourseState = require('../models/CourseState');
const KidsState = require('../models/KidsState');
const G = require('../lib/groups');
const D = require('../lib/dayStatus');
const TestState = require('../models/TestState');
const { summarizeTests } = require('../lib/testMerge');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('statusController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};
const COUNT0 = () => ({ done: 0, pending: 0, missed: 0, excused: 0, off: 0 });

function groupView(g) {
  return {
    id: g && g._id ? String(g._id) : null,
    lesson_days: D.cleanLessonDays(g && g.lesson_days) || D.DEFAULT_LESSON_DAYS,
    deadline_hour: D.cleanDeadlineHour(g && g.deadline_hour) || D.DEFAULT_DEADLINE_HOUR,
  };
}

const statusTable = wrap(async (req, res) => {
  const now = D.tashkentNow();
  const groups = await G.listGroups();
  const gByName = new Map(groups.map((g) => [g.name, g]));
  const students = await User.find({ role: 'student', status: { $ne: 'blocked' } })
    .select('full_name group_name excused_dates createdAt status program').lean();
  const states = await CourseState.find({ user: { $in: students.map((s) => s._id) } }).select('user state.pts state.d').lean();
  const stateBy = new Map(states.map((c) => [String(c.user), c.state]));
  // Kids 200 kun o'quvchilari: kun tugatilgan sanalar Kids holatidan (log: mahalliy kun raqami -> tugatilgan kunlar soni)
  const kidsIds = students.filter((s) => s.program === 'kids').map((s) => s._id);
  if (kidsIds.length) {
    for (const k of await KidsState.find({ user: { $in: kidsIds } }).select('user data').lean()) {
      let log = {};
      try { log = JSON.parse(k.data || '{}').log || {}; } catch (e) { log = {}; }
      const pts = {};
      for (const [d, n] of Object.entries(log)) if (Number(n) > 0 && Number.isInteger(Number(d))) pts[d] = { date: new Date(Number(d) * 864e5).toISOString().slice(0, 10) };
      stateBy.set(String(k.user), { pts, d: {} });
    }
    for (const id of kidsIds) if (!stateBy.has(String(id)) || stateBy.get(String(id)).pts === undefined) stateBy.set(String(id), { pts: {}, d: {} });
  }
  const tests = await TestState.find({ user: { $in: students.map((s) => s._id) } }).select('user res').lean();
  const testBy = new Map(tests.map((t) => [String(t.user), summarizeTests(t)]));

  const bucket = new Map(); // guruh nomi -> {group, students[]}
  const ensure = (name) => {
    if (!bucket.has(name)) { const g = gByName.get(name) || null; bucket.set(name, { name, g, students: [] }); }
    return bucket.get(name);
  };
  for (const g of groups) ensure(g.name);
  for (const s of students) {
    const name = s.group_name || '';
    const b = ensure(name);
    const joined = s.createdAt ? D.tashkentNow(new Date(s.createdAt)).date : null;
    const st = D.studentStatus({ group: b.g, state: stateBy.get(String(s._id)), excused_dates: s.excused_dates, today: now.date, hour: now.hour, joined });
    b.students.push({ id: String(s._id), full_name: s.full_name, ...st, tests: testBy.get(String(s._id)) || { vocab_passed: 0, grammar_passed: 0, last_day: 0 } });
  }

  const total = COUNT0();
  const out = [];
  for (const b of bucket.values()) {
    if (!b.students.length && !b.g) continue;
    const counts = COUNT0();
    for (const s of b.students) { counts[s.status]++; total[s.status]++; }
    b.students.sort(D.sortStudents);
    out.push({ name: b.name || 'Guruhsiz', ...groupView(b.g), lesson_today: D.isLessonDay(b.g, now.date), off_today: !!(b.g && (b.g.off_dates || []).includes(now.date)), counts, students: b.students });
  }
  res.status(200).json({ date: now.date, hour: now.hour, weekday: D.weekdayOf(now.date), total, groups: out });
});

const setSchedule = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Guruh topilmadi' });
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Guruh topilmadi' });
  if (req.body && req.body.lesson_days !== undefined) {
    const days = D.cleanLessonDays(req.body.lesson_days);
    if (!days) return res.status(400).json({ message: 'Kamida bitta dars kunini tanlang' });
    g.lesson_days = days;
  }
  if (req.body && req.body.deadline_hour !== undefined) {
    const h = D.cleanDeadlineHour(req.body.deadline_hour);
    if (h === null) return res.status(400).json({ message: "Muddat soati 8 dan 23 gacha bo'lsin" });
    g.deadline_hour = h;
  }
  await g.save();
  res.status(200).json(groupView(g));
});

const setOff = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Guruh topilmadi' });
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Guruh topilmadi' });
  const today = D.tashkentNow().date;
  const date = req.body && req.body.date ? String(req.body.date) : today;
  if (!D.validDate(date)) return res.status(400).json({ message: "Sana noto'g'ri" });
  if (date < D.addDays(today, -3) || date > D.addDays(today, 60)) return res.status(400).json({ message: "Sana juda uzoq (3 kun oldin — 60 kun keyin)" });
  const off = !(req.body && req.body.off === false);
  const set = new Set(g.off_dates || []);
  off ? set.add(date) : set.delete(date);
  g.off_dates = [...set].filter((d) => d >= D.addDays(today, -30)).sort();
  await g.save();
  res.status(200).json({ ok: true, date, off, off_dates: g.off_dates });
});

const setExcuse = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "O'quvchi topilmadi" });
  const u = await User.findOne({ _id: req.params.id, role: 'student' });
  if (!u) return res.status(404).json({ message: "O'quvchi topilmadi" });
  const today = D.tashkentNow().date;
  const date = req.body && req.body.date ? String(req.body.date) : today;
  if (!D.validDate(date) || date < D.addDays(today, -7) || date > today) return res.status(400).json({ message: "Sana noto'g'ri (oxirgi 7 kun)" });
  const on = !(req.body && req.body.on === false);
  const set = new Set(u.excused_dates || []);
  on ? set.add(date) : set.delete(date);
  u.excused_dates = [...set].filter((d) => d >= D.addDays(today, -60)).sort();
  await u.save();
  res.status(200).json({ ok: true, date, on });
});

module.exports = { statusTable, setSchedule, setOff, setExcuse };
