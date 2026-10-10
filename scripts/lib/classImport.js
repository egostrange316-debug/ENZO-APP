/**
 * Supabase'dagi davomat / uy vazifasi / topshiriqlar / xabarlarni MongoDB'ga yozadi.
 * Eski o'quvchi id'si (uuid) -> User.legacy_id orqali yangi _id ga o'giriladi. Qayta ishga tushirish xavfsiz (upsert / noyob indeks).
 * Mos o'quvchisi topilmaganlar (masalan chiqarib yuborilgan) o'tkazib yuboriladi va hisobotga yoziladi.
 */
const User = require('../../models/User');
const Attendance = require('../../models/Attendance');
const Homework = require('../../models/Homework');
const HomeworkSubmission = require('../../models/HomeworkSubmission');
const Message = require('../../models/Message');

async function importClassData({ attendance = [], homework = [], submissions = [], messages = [] }, { commit = false } = {}) {
  const users = await User.find({ legacy_id: { $exists: true } }).select('_id legacy_id').lean();
  const idOf = new Map(users.map((u) => [u.legacy_id, u._id]));
  const rep = { attendance: { ok: 0, skipped: 0 }, homework: { ok: 0, skipped: 0 }, submissions: { ok: 0, skipped: 0 }, messages: { ok: 0, skipped: 0 } };

  for (const a of attendance) {
    const uid = idOf.get(a.student_id);
    const date = String(a.lesson_date || '').slice(0, 10);
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['present', 'absent'].includes(a.status)) { rep.attendance.skipped++; continue; }
    if (commit) await Attendance.updateOne({ user: uid, date }, { $set: { status: a.status } }, { upsert: true });
    rep.attendance.ok++;
  }

  const hwId = new Map(); // eski uuid -> yangi _id
  for (const h of homework) {
    if (!h.title || !h.group_name || !h.starts_at || !h.ends_at) { rep.homework.skipped++; continue; }
    if (commit) {
      const doc = await Homework.findOneAndUpdate(
        { group_name: h.group_name, title: h.title, starts_at: new Date(h.starts_at), ends_at: new Date(h.ends_at) },
        { $setOnInsert: { reward_ball: h.reward_ball || 0, penalty_ball: h.penalty_ball || 0, settled_at: new Date() } }, // eski jarimalar Supabase'da allaqachon hisoblangan
        { upsert: true, new: true }
      );
      hwId.set(h.id, doc._id);
    } else hwId.set(h.id, h.id);
    rep.homework.ok++;
  }

  for (const s of submissions) {
    const uid = idOf.get(s.student_id); const hid = hwId.get(s.homework_id);
    if (!uid || !hid) { rep.submissions.skipped++; continue; }
    if (commit) {
      await HomeworkSubmission.updateOne({ homework: hid, user: uid },
        { $set: { submitted: !!s.submitted, image_url: s.image_url || null, submitted_at: s.submitted_at ? new Date(s.submitted_at) : undefined, on_time: !!s.on_time } }, { upsert: true });
    }
    rep.submissions.ok++;
  }

  for (const m of messages) {
    const from = idOf.get(m.sender_id); const to = idOf.get(m.receiver_id);
    const body = String(m.body || '').trim().slice(0, 2000);
    if (!from || !to || !body) { rep.messages.skipped++; continue; }
    if (commit) {
      const at = m.created_at ? new Date(m.created_at) : new Date();
      if (!(await Message.exists({ from, to, body, createdAt: at }))) await Message.collection.insertOne({ from, to, body, createdAt: at, updatedAt: at });
    }
    rep.messages.ok++;
  }
  return rep;
}

module.exports = { importClassData };
