const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, vocab, StudyPlan, User } = require('./helpers');
const PracticeItem = require('../models/PracticeItem');
const PracticeDay = require('../models/PracticeDay');

let t, s, u;
before(async () => {
  t = await setup();
  await t.makeAdmin();
  s = await t.makeStudent('Mashq Bola');
  u = await User.findOne({ full_name: 'Mashq Bola' });
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(4) });
  await StudyPlan.create({ day_number: 2, unit_title: 'U2', vocabulary: vocab, quizzes: quiz(4) });
  await User.updateOne({ _id: u._id }, { $set: { current_day: 2 } });
});
after(async () => { await t.teardown(); });

const call = (m, p, body) => t.call(m, p, { token: s.token, body });
const rightIdx = async (day, key) => (await StudyPlan.findOne({ day_number: day })).quizzes[Number(key.split(':')[1])].correct_answer_index;

test('darsdagi xato javob "Mashq"ga avtomatik tushadi', async () => {
  const lesson = (await call('GET', '/api/student/lesson/today')).data;
  const it = lesson.exercises[0];
  const right = await rightIdx(2, it.key);
  await call('POST', '/api/student/exercise/answer', { day_number: 2, key: it.key, answer: (right + 1) % 4 });
  assert.equal(await PracticeItem.countDocuments({ user: u._id, status: 'active' }), 1);
  const sum = (await call('GET', '/api/student/practice')).data;
  assert.equal(sum.counts.mistakes, 1);
  const m = (await call('GET', '/api/student/practice/mistakes')).data.mistakes;
  assert.equal(m.length, 1);
  assert.equal(JSON.stringify(m).includes('correct'), false);
});

test('takrorlashdagi (o\'tgan kun) xato ham tushadi', async () => {
  const r = await call('GET', '/api/student/lesson/day/1');
  const it = r.data.exercises[0];
  const right = await rightIdx(1, it.key);
  const a = await call('POST', '/api/student/exercise/answer', { day_number: 1, key: it.key, answer: (right + 1) % 4 });
  assert.equal(a.data.review, true);
  assert.equal(await PracticeItem.countDocuments({ user: u._id, status: 'active' }), 2);
});

test('kunlik mashq: xatolar birinchi, javoblarsiz; 2 marta ketma-ket to\'g\'ri -> chiqadi', async () => {
  const ses = (await call('GET', '/api/student/practice/session')).data;
  assert.ok(ses.items.length >= 2);
  assert.equal(ses.from_mistakes, 2);
  assert.equal(JSON.stringify(ses.items).includes('correct_index'), false);
  const it = ses.items.find((i) => i.key.startsWith('q:'));
  const right = await rightIdx(it.day_number, it.key);
  const bad = await call('POST', '/api/student/practice/answer', { day_number: it.day_number, key: it.key, answer: (right + 1) % 4 });
  assert.equal(bad.data.correct, false);
  assert.ok(bad.data.reveal);
  const g1 = await call('POST', '/api/student/practice/answer', { day_number: it.day_number, key: it.key, answer: right });
  assert.equal(g1.data.correct, true); assert.equal(g1.data.cleared, false);
  const g2 = await call('POST', '/api/student/practice/answer', { day_number: it.day_number, key: it.key, answer: right });
  assert.equal(g2.data.cleared, true);
  assert.equal(await PracticeItem.countDocuments({ user: u._id, status: 'active' }), 1);
  // yana xato qilsa qaytadan faol
  await call('POST', '/api/student/practice/answer', { day_number: it.day_number, key: it.key, answer: (right + 1) % 4 });
  assert.equal(await PracticeItem.countDocuments({ user: u._id, status: 'active' }), 2);
});

test('ochilmagan kun/yo\'q savol rad etiladi', async () => {
  assert.equal((await call('POST', '/api/student/practice/answer', { day_number: 3, key: 'q:0', answer: 0 })).status, 400);
  assert.equal((await call('POST', '/api/student/practice/answer', { day_number: 1, key: 'q:99', answer: 0 })).status, 404);
  assert.equal((await t.call('GET', '/api/student/practice')).status, 401);
});

test('mashq tugadi: XP va streak kuniga bir marta', async () => {
  const before = (await User.findById(u._id)).xp || 0;
  const a = await call('POST', '/api/student/practice/complete');
  assert.equal(a.data.first_today, true);
  assert.ok(a.data.xp > 0);
  assert.equal((await User.findById(u._id)).xp, before + a.data.xp);
  const b = await call('POST', '/api/student/practice/complete');
  assert.equal(b.data.first_today, false);
  assert.equal(b.data.xp, 0);
  assert.equal((await User.findById(u._id)).xp, before + a.data.xp);
  assert.equal(await PracticeDay.countDocuments({ user: u._id }), 1);
  const sum = (await call('GET', '/api/student/practice')).data;
  assert.equal(sum.today.practiced, true);
  assert.equal(sum.streak.current, 1);
});

test('so\'zlarim: ochilgan kunlar; xato qilinganlari qiyin deb belgilanadi (kitob so\'zlari)', async () => {
  const BookMaterial = require('../models/BookMaterial');
  const b = await BookMaterial.create({ uploaded_by: u._id, title: 'B', status: 'ready', assigned_day: 1, section_title: 'S',
    writing: { vocabulary: [{ word: 'apple', translation_uz: 'olma', example_sentence: 'An apple.' }, { word: 'pear', translation_uz: 'nok', example_sentence: 'A pear.' }, { word: 'plum', translation_uz: 'olxo\'ri' }] } });
  const w = (await call('GET', '/api/student/practice/words')).data;
  assert.ok(w.total >= 3);
  assert.equal(w.words.some((x) => x.word === 'apple' && x.hard === false), true);
  const lesson = (await call('GET', '/api/student/lesson/day/1')).data;
  const v = lesson.exercises.find((e) => /:v:0$/.test(e.key));
  assert.ok(v, 'vocab mcq topilmadi');
  await call('POST', '/api/student/exercise/answer', { day_number: 1, key: v.key, answer: 99 });
  const w2 = (await call('GET', '/api/student/practice/words')).data;
  assert.equal(w2.words.find((x) => x.word === 'apple').hard, true);
  assert.equal(w2.words.find((x) => x.word === 'pear').hard, false);
  await b.deleteOne();
});
