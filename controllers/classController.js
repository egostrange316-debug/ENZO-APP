/**
 * Sinf hayoti: o'quvchilar ro'yxati, davomat, uy vazifasi, xabarlar, avatar.
 * (Avval Supabase'da edi. Javob maydonlari eski nomlar bilan — ilova deyarli o'zgarishsiz ishlaydi.)
 * To'lov/obuna holati bu yerda o'quvchilarga HECH QACHON ko'rsatilmaydi.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Homework = require('../models/Homework');
const HomeworkSubmission = require('../models/HomeworkSubmission');
const Message = require('../models/Message');
const { dateKey } = require('../services/gameService');
const DayMastery = require('../models/DayMastery');
const { subscriptionInfo } = require('../lib/subscription');
const { courseProgressPercent } = require('../services/progressService');

const isId = (v) => mongoose.isValidObjectId(v);
const isAdmin = (req) => req.user.role === 'admin';
const fail = (res, e, where) => { console.error(`${where} xatosi:`, e); res.status(500).json({ message: 'Server xatosi' }); };

/** Ball ni 0 dan pastga tushirmasdan atomik ayirish */
async function subtractBall(userId, n) {
  if (!(n > 0)) return;
  const r = await User.updateOne({ _id: userId, ball: { $gte: n } }, { $inc: { ball: -n } });
  if (!r.modifiedCount) await User.updateOne({ _id: userId, ball: { $lt: n } }, { $set: { ball: 0 } });
}

/* ---------------- o'quvchilar ro'yxati ---------------- */
const roster = async (req, res) => {
  try {
    const rows = await User.find({ role: 'student' })
      .select('full_name group_name avatar ball xp current_day level status createdAt placement_pending')
      .lean();
    const admin = isAdmin(req);
    // Ko'rsatiladigan "ball" = o'yin tizimidagi XP + uy vazifasi bali (reyting va podium shunga qaraydi)
    const list = rows.map((u) => ({
      id: String(u._id), full_name: u.full_name, group_name: u.group_name, avatar: u.avatar,
      ball: (u.xp || 0) + (u.ball || 0), xp: u.xp || 0, homework_ball: u.ball || 0,
      current_day: u.current_day, level: u.level, created_at: u.createdAt,
      ...(admin ? { blocked: u.status === 'blocked', placement_pending: !!u.placement_pending } : {}),
    }));
    list.sort((a, b) => b.ball - a.ball || new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id));
    res.status(200).json({ students: list });
  } catch (e) { fail(res, e, 'roster'); }
};


/* ---------------- natijalar jadvali (daraja -> guruh) ---------------- */
/**
 * Hamma o'quvchi uchun bir xil raqamlar: kun, kurs foizi, aniqlik (oxirgi 14 ta yakunlangan kundagi birinchi urinish o'rtachasi),
 * davomat (oxirgi 30 kun), ball. To'lov FAQAT admin javobida (payment).
 */
const resultsTable = async (req, res) => {
  try {
    const admin = isAdmin(req);
    const users = await User.find({ role: 'student' })
      .select('full_name group_name avatar xp ball current_day level status subscription_end_date createdAt').lean();
    const ids = users.map((u) => u._id);
    const since = dateKey(new Date(Date.now() - 30 * 86400000));
    const [mast, att] = await Promise.all([
      DayMastery.find({ user: { $in: ids }, passes: { $gt: 0 } }).select('user day_number last_percent').sort({ day_number: -1 }).lean(),
      Attendance.find({ user: { $in: ids }, date: { $gte: since } }).select('user status').lean(),
    ]);
    const acc = new Map();
    for (const m of mast) {
      const k = String(m.user); const a = acc.get(k) || [];
      if (a.length < 14) { a.push(m.last_percent || 0); acc.set(k, a); }
    }
    const attMap = new Map();
    for (const r of att) {
      const k = String(r.user); const a = attMap.get(k) || { p: 0, t: 0 };
      a.t += 1; if (r.status === 'present') a.p += 1; attMap.set(k, a);
    }
    const rows = users.map((u) => {
      const k = String(u._id); const a = acc.get(k); const t = attMap.get(k);
      const row = {
        id: k, full_name: u.full_name, group_name: u.group_name || '', avatar: u.avatar, level: u.level, current_day: u.current_day,
        course_percent: courseProgressPercent(u.current_day, 0),
        accuracy: a && a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null,
        attendance: t && t.t ? Math.round((t.p / t.t) * 100) : null,
        ball: (u.xp || 0) + (u.ball || 0),
      };
      if (admin) { const sub = subscriptionInfo(u); row.payment = { state: sub.state, days_left: sub.days_left, grace_days_left: sub.grace_days_left, end_date: sub.end_date }; }
      return row;
    });
    res.status(200).json({ students: rows });
  } catch (e) { fail(res, e, 'resultsTable'); }
};

/* ---------------- avatar ---------------- */
const setAvatar = async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { avatar: req.savedImage } });
    res.status(200).json({ avatar: req.savedImage });
  } catch (e) { fail(res, e, 'setAvatar'); }
};

/* ---------------- davomat ---------------- */
const getAttendance = async (req, res) => {
  try {
    const since = dateKey(new Date(Date.now() - 120 * 86400000));
    let users;
    if (isAdmin(req)) {
      users = await User.find({ role: 'student', ...(req.query.group ? { group_name: String(req.query.group) } : {}) }).select('_id').lean();
    } else {
      users = await User.find({ role: 'student', group_name: req.user.group_name }).select('_id').lean();
    }
    const rows = await Attendance.find({ user: { $in: users.map((u) => u._id) }, date: { $gte: since } }).lean();
    res.status(200).json({ attendance: rows.map((r) => ({ student_id: String(r.user), lesson_date: r.date, status: r.status })) });
  } catch (e) { fail(res, e, 'getAttendance'); }
};

/** PUT (admin) { student_id, date, status } ; status 'clear' belgini olib tashlaydi */
const markAttendance = async (req, res) => {
  try {
    const { student_id, date, status } = req.body || {};
    if (!isId(student_id) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ message: "Ma'lumot noto'g'ri" });
    if (!['present', 'absent', 'clear'].includes(status)) return res.status(400).json({ message: "Holat noto'g'ri" });
    const stu = await User.findOne({ _id: student_id, role: 'student' }).select('_id').lean();
    if (!stu) return res.status(404).json({ message: "O'quvchi topilmadi" });
    if (status === 'clear') await Attendance.deleteOne({ user: student_id, date });
    else await Attendance.updateOne({ user: student_id, date }, { $set: { status, by: req.user._id } }, { upsert: true });
    res.status(200).json({ ok: true });
  } catch (e) { fail(res, e, 'markAttendance'); }
};

/* ---------------- uy vazifasi ---------------- */
/** Muddati o'tgan, hali hisoblanmagan vazifalar: topshirmaganlarga bir martalik jarima. Noyob indeks ikki marta jarimadan saqlaydi. */
async function settleOverdue() {
  const due = await Homework.find({ ends_at: { $lt: new Date() }, settled_at: { $exists: false } }).limit(50).lean();
  for (const hw of due) {
    const students = await User.find({ role: 'student', group_name: hw.group_name }).select('_id').lean();
    for (const s of students) {
      try {
        await HomeworkSubmission.create({ homework: hw._id, user: s._id, submitted: false, on_time: false });
      } catch (e) {
        if (e.code === 11000) continue; // topshirgan yoki boshqa so'rov allaqachon hisoblagan
        throw e;
      }
      await subtractBall(s._id, hw.penalty_ball);
    }
    await Homework.updateOne({ _id: hw._id }, { $set: { settled_at: new Date() } });
  }
}

const hwOut = (h) => ({ id: String(h._id), group_name: h.group_name, title: h.title, submission_type: 'photo', starts_at: h.starts_at, ends_at: h.ends_at, reward_ball: h.reward_ball, penalty_ball: h.penalty_ball, created_at: h.createdAt });
const subOut = (s) => ({ homework_id: String(s.homework), student_id: String(s.user), submitted: s.submitted, image_url: s.image_url, submitted_at: s.submitted_at, on_time: s.on_time });

const listHomework = async (req, res) => {
  try {
    await settleOverdue();
    let hws; let subs;
    if (isAdmin(req)) {
      hws = await Homework.find({}).sort({ createdAt: -1 }).limit(200).lean();
      subs = await HomeworkSubmission.find({ homework: { $in: hws.map((h) => h._id) } }).lean();
    } else {
      hws = await Homework.find({ group_name: req.user.group_name }).sort({ createdAt: -1 }).limit(100).lean();
      subs = await HomeworkSubmission.find({ user: req.user._id, homework: { $in: hws.map((h) => h._id) } }).lean();
    }
    res.status(200).json({ homeworks: hws.map(hwOut), submissions: subs.map(subOut) });
  } catch (e) { fail(res, e, 'listHomework'); }
};

const createHomework = async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const starts = new Date(b.starts_at); const ends = new Date(b.ends_at);
    if (!title || !b.group_name || isNaN(starts) || isNaN(ends) || ends <= starts) return res.status(400).json({ message: "Vazifa ma'lumotlari noto'g'ri (nom, guruh, boshlanish va tugash vaqti)" });
    const num = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
    const hw = await Homework.create({ group_name: String(b.group_name), title, starts_at: starts, ends_at: ends, reward_ball: num(b.reward_ball), penalty_ball: num(b.penalty_ball) });
    res.status(201).json({ homework: hwOut(hw) });
  } catch (e) { fail(res, e, 'createHomework'); }
};

const deleteHomework = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ message: 'ID noto\'g\'ri' });
    await HomeworkSubmission.deleteMany({ homework: req.params.id });
    await Homework.deleteOne({ _id: req.params.id });
    res.status(200).json({ ok: true });
  } catch (e) { fail(res, e, 'deleteHomework'); }
};

/** O'quvchi rasm topshiradi. O'z vaqtida va birinchi marta topshirsa reward_ball (faqat bir marta) beriladi. */
const submitHomework = async (req, res) => {
  try {
    if (isAdmin(req)) return res.status(403).json({ message: 'Faqat o\'quvchi topshiradi' });
    if (!isId(req.params.id)) return res.status(400).json({ message: 'ID noto\'g\'ri' });
    const hw = await Homework.findById(req.params.id).lean();
    if (!hw || hw.group_name !== req.user.group_name) return res.status(404).json({ message: 'Vazifa topilmadi' });
    const now = new Date();
    if (now < hw.starts_at) return res.status(400).json({ message: 'Vazifa hali boshlanmagan' });
    const onTime = now <= hw.ends_at;

    let flipped = false;
    try {
      const old = await HomeworkSubmission.findOneAndUpdate(
        { homework: hw._id, user: req.user._id, submitted: { $ne: true } },
        { $set: { submitted: true, image_url: req.savedImage, submitted_at: now, on_time: onTime } },
        { upsert: true, new: false }
      );
      flipped = true; void old;
    } catch (e) {
      if (e.code !== 11000) throw e;
      // allaqachon topshirilgan: rasmni almashtiramiz, mukofot qayta berilmaydi
      await HomeworkSubmission.updateOne({ homework: hw._id, user: req.user._id }, { $set: { image_url: req.savedImage, submitted_at: now } });
    }
    let rewarded = 0;
    if (flipped && onTime && hw.reward_ball > 0) {
      await User.updateOne({ _id: req.user._id }, { $inc: { ball: hw.reward_ball } });
      rewarded = hw.reward_ball;
    }
    res.status(200).json({ ok: true, on_time: onTime, rewarded, image_url: req.savedImage });
  } catch (e) { fail(res, e, 'submitHomework'); }
};

/* ---------------- xabarlar ---------------- */
const listMessages = async (req, res) => {
  try {
    const rows = await Message.find({ $or: [{ from: req.user._id }, { to: req.user._id }] }).sort({ createdAt: -1 }).limit(500).lean();
    rows.reverse();
    res.status(200).json({ messages: rows.map((m) => ({ id: String(m._id), sender_id: String(m.from), receiver_id: String(m.to), body: m.body, created_at: m.createdAt })) });
  } catch (e) { fail(res, e, 'listMessages'); }
};

const sendMessage = async (req, res) => {
  try {
    const to = req.body?.to; const body = String(req.body?.body || '').trim();
    if (!isId(to) || !body) return res.status(400).json({ message: 'Xabar bo\'sh yoki qabul qiluvchi noto\'g\'ri' });
    if (body.length > 2000) return res.status(400).json({ message: 'Xabar juda uzun' });
    if (String(to) === String(req.user._id)) return res.status(400).json({ message: "O'zingizga yozib bo'lmaydi" });
    if (!(await User.exists({ _id: to }))) return res.status(404).json({ message: 'Qabul qiluvchi topilmadi' });
    const m = await Message.create({ from: req.user._id, to, body });
    res.status(201).json({ message: { id: String(m._id), sender_id: String(m.from), receiver_id: String(m.to), body: m.body, created_at: m.createdAt } });
  } catch (e) { fail(res, e, 'sendMessage'); }
};

module.exports = {
  resultsTable, roster, setAvatar, getAttendance, markAttendance, listHomework, createHomework, deleteHomework, submitHomework, listMessages, sendMessage, settleOverdue };
