const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, vocab, StudyPlan, User } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.teardown(); });

const ans = (s, day, key, answer) => t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key, answer } });

test('o\'qituvchi jadvali: foiz, birinchi urinish aniqligi, to\'lov holati; reyting: ochiq ism/foiz, to\'lov YO\'Q', async () => {
  const admin = await t.makeAdmin('Table Admin');
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(4) });

  const a = await t.makeStudent('Ali Valiyev');
  const b = await t.makeStudent('Bobur Karimov');
  const c = await t.makeStudent('Zilola Tosheva');
  // Ali: 2/4 (birinchisi bir xato bilan)
  await ans(a, 1, 'q:0', 3); await ans(a, 1, 'q:0', 0); await ans(a, 1, 'q:1', 1);
  // Bobur: 4/4 birinchi urinishda
  for (let i = 0; i < 4; i++) await ans(b, 1, `q:${i}`, i % 4);
  // Zilola: kutish muddatida (to'lov muddati o'tgan)
  await User.updateOne({ _id: c.user.id }, { subscription_end_date: new Date(Date.now() - 2 * 86400000) });

  const tbl = await t.call('GET', '/api/admin/students', { token: admin });
  assert.equal(tbl.status, 200);
  const rows = Object.fromEntries(tbl.data.students.map((s) => [s.full_name, s]));
  assert.equal(rows['Ali Valiyev'].today.percent, 50);
  assert.equal(rows['Ali Valiyev'].today.first_try_percent, 25);
  assert.equal(rows['Ali Valiyev'].today.wrong_total, 1);
  assert.equal(rows['Bobur Karimov'].today.percent, 100);
  assert.equal(rows['Bobur Karimov'].today.first_try_percent, 100);
  assert.equal(rows['Ali Valiyev'].subscription.state, 'paid');
  assert.equal(rows['Zilola Tosheva'].subscription.state, 'grace');
  assert.equal(rows['Zilola Tosheva'].today.percent, 0);
  assert.equal(rows['Bobur Karimov'].course_percent, 0.2); // (0 tugagan kun + 100%) / 646 = 0.155 -> 0.2

  // Reyting: o'quvchi ko'radi, to'lov maydonlari yo'q
  const lb = await t.call('GET', '/api/student/leaderboard', { token: a.token });
  assert.equal(lb.status, 200);
  assert.equal(lb.data.leaderboard.length, 3);
  assert.equal(lb.data.leaderboard[0].full_name, 'Bobur Karimov');
  assert.equal(lb.data.leaderboard[0].rank, 1);
  assert.equal(lb.data.leaderboard.find((r) => r.is_me).full_name, 'Ali Valiyev');
  const raw = JSON.stringify(lb.data);
  assert.ok(!/subscription|payment|status|blocked|password|legacy/.test(raw), "reytingda to'lov/ichki maydonlar bo'lmasligi kerak");
  assert.equal((await t.call('GET', '/api/student/leaderboard')).status, 401);

  // O'z progressi
  const me = await t.call('GET', '/api/student/progress', { token: a.token });
  assert.equal(me.data.today.percent, 50);
  assert.equal(me.data.day_number, 1);
});

test('progress turlari: imtihon kuni (urinishlar), final (Speaking), kurs tugagan, bloklangan o\'quvchi reytingni ko\'ra olmaydi', async () => {
  const admin = await t.makeAdmin('Table Admin 2');
  await StudyPlan.create({ day_number: 7, unit_title: 'C7', vocabulary: vocab, quizzes: quiz(2) });
  const e = await t.makeStudent('Exam Row Kid');
  await User.updateOne({ _id: e.user.id }, { current_day: 7 });
  await t.call('POST', '/api/student/exam/submit', { token: e.token, body: { day_number: 7, answers: [{ key: 'q:0', answer: 0 }] } }); // 50%

  const f = await t.makeStudent('Final Row Kid');
  await User.updateOne({ _id: f.user.id }, { current_day: 70 });
  const done = await t.makeStudent('Done Row Kid');
  await User.updateOne({ _id: done.user.id }, { current_day: 647 });

  const tbl = await t.call('GET', '/api/admin/students', { token: admin });
  const rows = Object.fromEntries(tbl.data.students.map((s) => [s.full_name, s]));
  assert.equal(rows['Exam Row Kid'].today.kind, 'exam');
  assert.equal(rows['Exam Row Kid'].today.attempts_count, 1);
  assert.equal(rows['Exam Row Kid'].today.first_attempt_percent, 50);
  assert.equal(rows['Exam Row Kid'].today.best_percent, 50);
  assert.equal(rows['Final Row Kid'].today.kind, 'final');
  assert.equal(rows['Final Row Kid'].today.speaking_approved, false);
  assert.equal(rows['Done Row Kid'].today.kind, 'finished');
  assert.equal(rows['Done Row Kid'].course_percent, 100);

  const blocked = await t.makeStudent('Blocked Row Kid');
  await User.updateOne({ _id: blocked.user.id }, { subscription_end_date: new Date(Date.now() - 9 * 86400000) });
  assert.equal((await t.call('GET', '/api/student/leaderboard', { token: blocked.token })).status, 403);
});
