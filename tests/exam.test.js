const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, fill, vocab, StudyPlan, User } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.teardown(); });

const submit = (s, day, answers) => t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: day, answers } });
const prac = (s, day, key, answer) => t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key, answer } });
const today = (s) => t.call('GET', '/api/student/lesson/today', { token: s.token });

test('imtihon C varianti: aralash savollar, yiqilsa tahlil + mini-mashq (takrorlanadi) -> qayta topshirish; urinishlar va eng yaxshi ball', async () => {
  // 5 savol: q:0..q:3 (to'g'ri 0,1,2,3) va f:0 (word0)
  await StudyPlan.create({ day_number: 7, unit_title: 'Check 7', vocabulary: vocab, quizzes: quiz(4), fill_in_the_blanks: fill(1) });
  const s = await t.makeStudent('Exam C Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 7 });

  const l1 = await today(s);
  assert.equal(l1.data.exam.phase, 'exam');
  assert.equal(l1.data.exam.attempt_number, 1);
  assert.equal(l1.data.exam_items.length, 5);
  assert.ok(!JSON.stringify(l1.data).includes('correct_'), 'javob sizib chiqdi');
  assert.deepEqual(l1.data.exam_items.map((i) => i.key).sort(), ['f:0', 'q:0', 'q:1', 'q:2', 'q:3']);

  // 1-urinish: 3/5 = 60% -> yiqiladi (q:2 va q:3 xato)
  const a1 = [{ key: 'q:0', answer: 0 }, { key: 'q:1', answer: 1 }, { key: 'q:2', answer: 0 }, { key: 'q:3', answer: 0 }, { key: 'f:0', answer: 'word0' }];
  const r1 = await submit(s, 7, a1);
  assert.equal(r1.data.passed, false);
  assert.equal(r1.data.score_percent, 60);
  assert.equal(r1.data.attempt_number, 1);
  assert.equal(r1.data.first_attempt_percent, 60);
  assert.equal(r1.data.new_current_day, 7);
  assert.deepEqual(r1.data.review.map((x) => x.key).sort(), ['q:2', 'q:3']);
  const rv = Object.fromEntries(r1.data.review.map((x) => [x.key, x]));
  assert.deepEqual(rv['q:2'].correct, { index: 2, text: 'c' });
  assert.equal(rv['q:2'].your_answer, 0);

  // Qayta topshirish mini-mashqsiz mumkin emas
  assert.equal((await submit(s, 7, a1)).data.code, 'practice_required');

  // Mini-mashq: faqat xato qilingan 2 savol; to'g'ri javobsiz
  const l2 = await today(s);
  assert.equal(l2.data.exam.phase, 'practice');
  assert.equal(l2.data.exam_items, undefined);
  assert.deepEqual(l2.data.practice.exercises.map((e) => e.key).sort(), ['p1:q:2', 'p1:q:3']);
  assert.ok(!JSON.stringify(l2.data).includes('correct_'));
  assert.equal(l2.data.practice.progress.percent, 0);

  // Xato javob -> takrorlanadi (cheklovsiz); begona/eski kalit rad etiladi
  assert.equal((await prac(s, 7, 'p1:q:2', 1)).data.correct, false);
  assert.equal((await prac(s, 7, 'q:2', 2)).status, 404, 'oddiy kalit imtihon kunida ishlamaydi');
  assert.equal((await prac(s, 7, 'p1:q:0', 0)).status, 404, 'xato qilinmagan savol mini-mashqda yo\'q');
  assert.equal((await prac(s, 7, 'p1:q:2', 2)).data.correct, true);
  assert.equal((await submit(s, 7, a1)).data.code, 'practice_required', 'bittasi qoldi');
  const last = await prac(s, 7, 'p1:q:3', 3);
  assert.equal(last.data.progress.percent, 100);

  // Endi imtihon yana ochiq, savollar yana aralashadi
  const l3 = await today(s);
  assert.equal(l3.data.exam.phase, 'exam');
  assert.equal(l3.data.exam.attempt_number, 2);
  assert.equal(l3.data.exam.best_percent, 60);
  assert.equal(l3.data.exam.first_attempt_percent, 60);

  // 2-urinish: hammasi to'g'ri -> o'tadi, kun oshadi; birinchi urinish ko'rsatkichi o'zgarmaydi
  const a2 = [{ key: 'q:0', answer: 0 }, { key: 'q:1', answer: 1 }, { key: 'q:2', answer: 2 }, { key: 'q:3', answer: 3 }, { key: 'f:0', answer: 'WORD0' }];
  const r2 = await submit(s, 7, a2);
  assert.equal(r2.data.passed, true);
  assert.equal(r2.data.score_percent, 100);
  assert.equal(r2.data.attempt_number, 2);
  assert.equal(r2.data.first_attempt_percent, 60);
  assert.equal(r2.data.best_percent, 100);
  assert.equal(r2.data.new_current_day, 8);
  assert.equal(r2.data.review, undefined);
  assert.equal((await User.findById(s.user.id)).current_day, 8);
});

test('imtihon: javob yubormagan savol xato hisoblanadi; qo\'sh bosish bitta urinish yozadi', async () => {
  await StudyPlan.create({ day_number: 14, unit_title: 'Check 14', vocabulary: vocab, quizzes: quiz(2) });
  const s = await t.makeStudent('Exam Dup Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 14 });
  const r = await submit(s, 14, [{ key: 'q:0', answer: 0 }]); // q:1 yo'q -> 50%
  assert.equal(r.data.score_percent, 50);
  assert.equal(r.data.passed, false);

  await StudyPlan.create({ day_number: 21, unit_title: 'Check 21', vocabulary: vocab, quizzes: quiz(1) });
  const d = await t.makeStudent('Exam Tap Kid');
  await User.updateOne({ _id: d.user.id }, { current_day: 21 });
  const rs = await Promise.all([submit(d, 21, [{ key: 'q:0', answer: 0 }]), submit(d, 21, [{ key: 'q:0', answer: 0 }])]);
  assert.ok(rs.some((x) => x.status === 200 && x.data.passed));
  const u = await User.findById(d.user.id);
  assert.equal(u.current_day, 22, 'kun ikki marta oshmaydi');
  const ExamAttempt = require('../models/ExamAttempt');
  assert.ok((await ExamAttempt.countDocuments({ user: d.user.id, day_number: 21 })) <= 2);
});
