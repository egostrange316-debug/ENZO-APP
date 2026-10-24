const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, User } = require('./helpers');
const { importClassData } = require('../scripts/lib/classImport');
const Attendance = require('../models/Attendance');
const Homework = require('../models/Homework');
const HomeworkSubmission = require('../models/HomeworkSubmission');
const Message = require('../models/Message');

let t, a, b;
before(async () => { t = await setup(); a = await t.makeStudent('Eski Bola 1'); b = await t.makeStudent('Eski Bola 2'); });
after(async () => { await t.teardown(); });

test('Supabase qatorlari legacy_id orqali ko\'chadi; quruq ishlash yozmaydi; qayta ishga tushirish dublikat qilmaydi', async () => {
  const la = a.user.legacy_id, lb = b.user.legacy_id;
  const data = {
    attendance: [{ student_id: la, lesson_date: '2026-09-01', status: 'present' }, { student_id: 'yoq', lesson_date: '2026-09-01', status: 'absent' }, { student_id: lb, lesson_date: 'xato', status: 'absent' }],
    homework: [{ id: 'h1', group_name: '1-guruh', title: 'Eski vazifa', starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-02T00:00:00Z', reward_ball: 5, penalty_ball: 3 }],
    submissions: [{ homework_id: 'h1', student_id: la, submitted: true, image_url: 'https://x/y.jpg', on_time: true, submitted_at: '2026-09-01T10:00:00Z' }, { homework_id: 'h1', student_id: lb, submitted: false, on_time: false }, { homework_id: 'nope', student_id: la }],
    messages: [{ sender_id: la, receiver_id: lb, body: 'Salom', created_at: '2026-09-01T09:00:00Z' }, { sender_id: 'yoq', receiver_id: lb, body: 'x' }],
  };
  const dry = await importClassData(data, { commit: false });
  assert.deepEqual([dry.attendance.ok, dry.attendance.skipped, dry.submissions.ok, dry.submissions.skipped, dry.messages.ok, dry.messages.skipped], [1, 2, 2, 1, 1, 1]);
  assert.equal(await Attendance.countDocuments(), 0);
  await importClassData(data, { commit: true });
  await importClassData(data, { commit: true });
  assert.equal(await Attendance.countDocuments(), 1);
  assert.equal(await Homework.countDocuments(), 1);
  assert.equal(await HomeworkSubmission.countDocuments(), 2);
  assert.equal(await Message.countDocuments(), 1);
  const ball = (await User.findById(b.user.id)).ball;
  // eski jarima qayta hisoblanmaydi: vazifa 'settled'
  const hw = await t.call('GET', '/api/class/homework', { token: b.token });
  assert.equal(hw.status, 200);
  assert.equal((await User.findById(b.user.id)).ball, ball);
});
