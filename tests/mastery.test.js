const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, vocab, StudyPlan, User } = require('./helpers');
const ExerciseProgress = require('../models/ExerciseProgress');
const DayMastery = require('../models/DayMastery');

let t, admin, s, u;
before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  s = await t.makeStudent('Mavzu Bola');
  u = await User.findOne({ full_name: 'Mavzu Bola' });
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(4) });
  await StudyPlan.create({ day_number: 2, unit_title: 'U2', vocabulary: vocab, quizzes: quiz(2) });
});
after(async () => { await t.teardown(); });

const items = async () => (await t.call('GET', '/api/student/lesson/today', { token: s.token })).data;
const full = async (d) => (await StudyPlan.findOne({ day_number: d })).quizzes;

/** Hamma savolga avval xato, keyin to'g'ri javob (birinchi urinish xato) yoki darhol to'g'ri */
async function play(day, { firstTryRight }) {
  const lesson = await items();
  const q = await full(day);
  for (const it of lesson.exercises) {
    const idx = Number(it.key.split(':')[1]);
    const right = q[idx].correct_answer_index;
    if (!firstTryRight) await t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key: it.key, answer: (right + 1) % 4 } });
    await t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key: it.key, answer: right } });
  }
  return t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: day } });
}

test('hammasini xato bilan topsa -> qayta o\'tish, kun o\'zgarmaydi, mashqlar noldan', async () => {
  const r = await play(1, { firstTryRight: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.retry_required, true);
  assert.equal(r.data.mastery_percent, 0);
  assert.equal((await User.findById(u._id)).current_day, 1);
  assert.equal(await ExerciseProgress.countDocuments({ user: u._id, day_number: 1 }), 0);
  const lesson = await items();
  assert.equal(lesson.mastery.retry, true);
  assert.equal(lesson.mastery.passes, 1);
  assert.equal(lesson.progress.done, 0);
});

test('qayta o\'tishda XP qayta berilmaydi', async () => {
  const before = (await User.findById(u._id)).xp;
  const r = await play(1, { firstTryRight: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.new_current_day, 2);
  const after = (await User.findById(u._id)).xp;
  // faqat kunni yakunlash XP'i (mashq XP'i qayta berilmaydi)
  assert.ok(after - before <= 50 + 5, `xp oshishi ${after - before}`);
  const m = await DayMastery.findOne({ user: u._id, day_number: 1 });
  assert.equal(m.mastered, true);
  assert.equal(m.passes, 2);
});

test('3 marta o\'zlashtirmasa o\'qituvchiga belgi tushadi; o\'qituvchi qo\'lda o\'tkazadi', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await play(2, { firstTryRight: false })).data.retry_required, true);
  const panel = await t.call('GET', '/api/admin/today', { token: admin });
  const st = panel.data.groups.flatMap((g) => g.students).find((x) => x.full_name === 'Mavzu Bola');
  assert.equal(st.retry, true);
  assert.equal(st.needs_teacher, true);
  assert.equal((await t.call('POST', `/api/admin/students/${u._id}/pass-day`, { token: s.token })).status, 403);
  // 450 kunlik tizimda qo'lda o'tkazish 'Kunni o'rnatish' orqali bajariladi
  assert.equal((await t.call('POST', `/api/admin/students/${u._id}/pass-day`, { token: admin })).status, 410);
});

test('o\'quvchi kartochkasi: to\'lov, davomat, o\'zlashtirish, qiyin savollar', async () => {
  await t.call('PUT', '/api/class/attendance', { token: admin, body: { student_id: String(u._id), date: new Date().toISOString().slice(0, 10), status: 'present' } });
  await t.call('POST', `/api/admin/students/${u._id}/pay`, { token: admin, body: { months: 3, amount: 200000, note: 'naqd' } });
  const r = await t.call('GET', `/api/admin/students/${u._id}/card`, { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.data.attendance.present, 1);
  assert.ok(r.data.mastery.find((m) => m.day === 1 && m.mastered));
  assert.ok(r.data.mastery.find((m) => m.day === 2 && m.teacher_passed));
  assert.equal(r.data.payments.length, 1);
  assert.equal((await t.call('GET', `/api/admin/students/${u._id}/card`, { token: s.token })).status, 403);
  assert.equal((await t.call('GET', '/api/admin/students/64b000000000000000000000/card', { token: admin })).status, 404);
});

test('o\'qituvchi o\'quvchi kunini qo\'lda belgilaydi (daraja kundan hisoblanadi)', async () => {
  assert.equal((await t.call('POST', `/api/admin/students/${u._id}/set-day`, { token: admin, body: { day: 0 } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${u._id}/set-day`, { token: admin, body: { day: 9999 } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${u._id}/set-day`, { token: s.token, body: { day: 80 } })).status, 403);
  const r = await t.call('POST', `/api/admin/students/${u._id}/set-day`, { token: admin, body: { day: 150 } });
  assert.equal(r.status, 200);
  const fresh = await User.findById(u._id);
  assert.equal(fresh.current_day, 150);
  assert.equal(fresh.level, 'elementary'); // 450 kunlik kurs: 91–174 = A2
});
