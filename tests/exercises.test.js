const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, fill, vocab, StudyPlan, User } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.teardown(); });

const ans = (s, day, key, answer) =>
  t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key, answer } });

test('dars javobsiz keladi; noto\'g\'ri javob keyinroq qaytadi; 2-xatoda maslahat, 3-xatoda javob ochiladi; foizlar', async () => {
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(2), fill_in_the_blanks: fill(2) });
  await StudyPlan.create({ day_number: 2, unit_title: 'U2', vocabulary: vocab, quizzes: quiz(1) });
  const s = await t.makeStudent('Retry Kid');

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  const raw = JSON.stringify(lesson.data);
  assert.ok(!raw.includes('correct_answer_index') && !raw.includes('correct_word') && !raw.includes('correct_index'), 'javoblar sizib chiqdi');
  assert.equal(lesson.data.exercises.length, 4);
  assert.equal(lesson.data.progress.percent, 0);

  // q:0 to'g'ri javobi = 0. Xato: 1
  let r = await ans(s, 1, 'q:0', 1);
  assert.equal(r.data.correct, false);
  assert.equal(r.data.wrong_count, 1);
  assert.equal(r.data.hint, undefined);
  assert.equal(r.data.progress.percent, 0);

  r = await ans(s, 1, 'q:0', 2);
  assert.equal(r.data.wrong_count, 2);
  assert.equal(r.data.hint.type, 'eliminate_option');
  assert.notEqual(r.data.hint.option_index, 0); // to'g'ri variantni olib tashlamaydi
  assert.equal(r.data.reveal, undefined);

  r = await ans(s, 1, 'q:0', 3);
  assert.equal(r.data.wrong_count, 3);
  assert.deepEqual(r.data.reveal, { correct_index: 0, correct_text: 'a' });
  assert.equal(r.data.must_retype, true);
  assert.equal(r.data.progress.done, 0, 'javob ko\'rsatilgani savolni tugatmaydi');

  // cheklov yo'q: yana xato qila oladi
  r = await ans(s, 1, 'q:0', 1);
  assert.equal(r.data.correct, false);
  assert.equal(r.status, 200);

  // keyin to'g'ri -> done, lekin birinchi urinishda emas
  r = await ans(s, 1, 'q:0', 0);
  assert.equal(r.data.correct, true);
  assert.equal(r.data.progress.done, 1);
  assert.equal(r.data.progress.percent, 25);
  assert.equal(r.data.progress.first_try_percent, 0);

  // f:0 birinchi urinishda; matn katta-kichik harf va bo'shliqqa e'tiborsiz
  r = await ans(s, 1, 'f:0', '  WORD0 ');
  assert.equal(r.data.correct, true);
  assert.equal(r.data.progress.percent, 50);
  assert.equal(r.data.progress.first_try_percent, 25);

  // f:1: bo'sh joy variantsiz -> 2-xatoda birinchi harf maslahati
  await ans(s, 1, 'f:1', 'x');
  r = await ans(s, 1, 'f:1', 'y');
  assert.deepEqual(r.data.hint, { type: 'first_letter', text: 'w____ (5 harf)' });

  // ilovani yopib qayta ochsa: holat saqlangan
  const again = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  const states = Object.fromEntries(again.data.exercises.map((e) => [e.key, e.state]));
  assert.equal(states['q:0'].status, 'done');
  assert.equal(states['f:1'].status, 'pending');
  assert.equal(states['f:1'].wrong, 2);
  assert.equal(again.data.progress.percent, 50);

  // tugagan savolga qayta javob foizni buzmaydi
  r = await ans(s, 1, 'q:0', 3);
  assert.equal(r.data.already_done, true);
  assert.equal(r.data.progress.percent, 50);
});

test('hamma to\'g\'ri bo\'lgach kun yakunlanadi; xato kun/kalit/ruxsatsiz kun rad etiladi', async () => {
  await StudyPlan.create({ day_number: 9, unit_title: 'U9', vocabulary: vocab, quizzes: quiz(1) });
  await StudyPlan.create({ day_number: 10, unit_title: 'U10', vocabulary: vocab, quizzes: quiz(1) });
  const s = await t.makeStudent('Finish Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 9 });

  assert.equal((await ans(s, 10, 'q:0', 0)).status, 403, 'hali ochilmagan kun');
  assert.equal((await ans(s, 9, 'zzz', 0)).status, 404);
  assert.equal((await ans(s, 0, 'q:0', 0)).status, 400);
  assert.equal((await t.call('POST', '/api/student/exercise/answer', { body: { day_number: 9, key: 'q:0', answer: 0 } })).status, 401);

  assert.equal((await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 9 } })).status, 409);
  await ans(s, 9, 'q:0', 0);
  const done = await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 9 } });
  assert.equal(done.status, 200);
  assert.equal(done.data.new_current_day, 10);
});

test('takrorlash: o\'tgan kun javobsiz keladi, holat saqlanmaydi, keyingi kun yopiq', async () => {
  const s = await t.makeStudent('Review Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 2 });

  const rev = await t.call('GET', '/api/student/lesson/day/1', { token: s.token });
  assert.equal(rev.status, 200);
  assert.equal(rev.data.review, true);
  assert.ok(!JSON.stringify(rev.data).includes('correct'));

  const bad = await ans(s, 1, 'q:0', 3);
  assert.equal(bad.data.correct, false);
  assert.equal(bad.data.review, true);
  assert.deepEqual(bad.data.reveal, { correct_index: 0, correct_text: 'a' });
  assert.equal((await ans(s, 1, 'q:0', 0)).data.correct, true);

  assert.equal((await t.call('GET', '/api/student/lesson/day/2', { token: s.token })).status, 403, 'joriy kun takrorlash emas');
  assert.equal((await t.call('GET', '/api/student/lesson/day/3', { token: s.token })).status, 403);
});

test('reja o\'zgarsa (o\'qituvchi savol qo\'shdi): eski natijalar saqlanadi, yangi savol pending', async () => {
  await StudyPlan.create({ day_number: 4, unit_title: 'U4', vocabulary: vocab, quizzes: quiz(1) });
  const s = await t.makeStudent('Plan Change Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 4 });
  await ans(s, 4, 'q:0', 0);
  await StudyPlan.updateOne({ day_number: 4 }, { $set: { fill_in_the_blanks: fill(1) } });
  const l = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(l.data.exercises.length, 2);
  assert.equal(l.data.progress.done, 1);
  assert.equal(l.data.progress.percent, 50);
});

test('parallel javoblar: qo\'sh bosish foizni va xatolarni buzmaydi', async () => {
  await StudyPlan.create({ day_number: 5, unit_title: 'U5', vocabulary: vocab, quizzes: quiz(2) });
  const s = await t.makeStudent('Double Tap Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 5 });
  const rs = await Promise.all([ans(s, 5, 'q:0', 0), ans(s, 5, 'q:0', 0), ans(s, 5, 'q:1', 1)]);
  assert.ok(rs.every((r) => r.status === 200 && r.data.correct));
  const l = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(l.data.progress.done, 2);
  assert.equal(l.data.progress.percent, 100);
});

test('eski so\'zlarni takrorlash: barqaror, bugungi so\'zlar kirmaydi, imtihon kunida yo\'q', () => {
  const ex = require('../services/exerciseService');
  const pool = ['cat', 'dog', 'sun', 'moon', 'star', 'tree', 'book', 'door'].map((w) => ({ word: w, translation_uz: `${w}-uz` }));
  const a = ex.reviewItems(9, pool, ['cat']);
  const b = ex.reviewItems(9, pool, ['cat']);
  assert.deepEqual(a, b, 'har chaqiruvda bir xil bo\'lishi shart');
  assert.equal(a.length, 5);
  assert.ok(a.every((i) => i.kind === 'mcq' && i.options[i.correct_index].endsWith('-uz') && i.key.startsWith('o:')));
  assert.ok(!a.some((i) => i.key === 'o:cat'));
  assert.ok(a.every((i) => new Set(i.options).size === i.options.length));
  assert.notDeepEqual(a.map((i) => i.key), ex.reviewItems(10, pool, ['cat']).map((i) => i.key));
  assert.equal(ex.reviewItems(2, [], []).length, 0);
});

test('oraliqli takrorlash: 1, 3, 7, 14, 30 kun oldingi so\'zlar qaytadi', () => {
  const ex = require('../services/exerciseService');
  const day = 40;
  const pool = [];
  for (let d = 1; d < day; d++) { pool.push({ word: `w${d}a`, translation_uz: `t${d}a`, _day: d }, { word: `w${d}b`, translation_uz: `t${d}b`, _day: d }); }
  const keys = ex.reviewItems(day, pool, []).map((i) => i.key);
  for (const off of [1, 3, 7, 14, 30]) {
    assert.ok(keys.some((k) => k.startsWith(`o:w${day - off}`)), `${off} kun oldingi so'z yo'q`);
  }
});

test('Writing va Speaking: yetarli bo\'lmasa xato hisoblanmaydi; bajarilsa matn saqlanadi va mastery buzilmaydi', async () => {
  const BookMaterial = require('../models/BookMaterial');
  const ExerciseProgress = require('../models/ExerciseProgress');
  await StudyPlan.create({ day_number: 30, unit_title: 'W', vocabulary: vocab });
  const s = await t.makeStudent('Write Kid');
  await User.updateOne({ full_name: 'Write Kid' }, { $set: { current_day: 30 } });
  const admin = await User.findOne({ role: 'admin' });
  const b = await BookMaterial.create({
    uploaded_by: admin ? admin._id : (await User.findOne({}))._id, title: 'Family', status: 'ready', assigned_day: 30, section_title: 'S',
    writing: { vocabulary: [{ word: 'mother', translation_uz: 'ona' }, { word: 'father', translation_uz: 'ota' }, { word: 'family', translation_uz: 'oila' }, { word: 'big house', translation_uz: 'katta uy' }] },
    speaking: { questions: [{ topic: 'Family', question_text: 'Tell me about your family.', hint_words: ['mother', 'father'] }] },
  });
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  const wr = lesson.data.exercises.find((e) => e.kind === 'write');
  const sp = lesson.data.exercises.find((e) => e.kind === 'speak');
  assert.ok(wr && sp, 'write/speak topshiriqlari kelmadi');
  assert.deepEqual(wr.must_words, ['mother', 'father', 'family']);
  assert.ok(!JSON.stringify(lesson.data).includes('correct_word":"mother'));

  let r = await ans(s, 30, wr.key, 'My mother');
  assert.equal(r.data.correct, false);
  assert.equal(r.data.task.short, true);
  assert.deepEqual(r.data.task.missing, ['father', 'family']);
  assert.equal(r.data.wrong_count, undefined, 'xato hisoblanmasligi kerak');
  const tried = await ExerciseProgress.findOne({ key: wr.key }).lean();
  assert.equal(tried.status, 'pending');
  assert.equal(tried.wrong, 0, 'xato hisoblanmasligi kerak');

  r = await ans(s, 30, wr.key, 'This is my family. My mother is kind. My father is strong.');
  assert.equal(r.data.correct, true);
  const saved = await ExerciseProgress.findOne({ key: wr.key }).lean();
  assert.equal(saved.status, 'done');
  assert.equal(saved.first_try, true);
  assert.match(saved.answer_text, /mother is kind/);

  assert.equal((await ans(s, 30, sp.key, '   ')).data.correct, false);
  r = await ans(s, 30, sp.key, 'I have a big family');
  assert.equal(r.data.correct, true);

  // O'qituvchi yozilgan va aytilgan javoblarni ko'ra oladi
  const adminTok = await t.makeAdmin('Teacher W', 'adminpass123');
  const uid = String((await User.findOne({ full_name: 'Write Kid' }))._id);
  const wl = await t.call('GET', `/api/admin/students/${uid}/writings`, { token: adminTok });
  assert.equal(wl.status, 200);
  assert.equal(wl.data.writings.length, 2);
  assert.deepEqual(wl.data.writings.map((w) => w.kind).sort(), ['speaking', 'writing']);
  assert.equal((await t.call('GET', `/api/admin/students/${uid}/writings`, { token: s.token })).status, 403);
  await b.deleteOne();
});

test('ro\'yxatdan o\'tish: daraja tanlanadi, guruh ixtiyoriy; o\'qituvchi joylaydi', async () => {
  const { LEVEL_RANGES } = require('../config/curriculum');
  const r = await t.call('POST', '/api/auth/register', { body: { full_name: 'Level Kid', password: 'pass1234', level: 'pre-intermediate' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.level, 'pre-intermediate');
  assert.equal(r.data.user.current_day, LEVEL_RANGES['pre-intermediate'].from);
  assert.equal(r.data.user.group_name, null);
  assert.equal(r.data.user.placement_pending, true);
  assert.equal((await t.call('POST', '/api/auth/register', { body: { full_name: 'Bad Lvl', password: 'pass1234', level: 'nope' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/register', { body: { full_name: 'Bad Grp', password: 'pass1234', group_name: 'x-guruh' } })).status, 400);
  const d = await t.call('POST', '/api/auth/register', { body: { full_name: 'Default Kid', password: 'pass1234' } });
  assert.equal(d.data.user.level, 'beginner');
  assert.equal(d.data.user.current_day, 1);

  const adminTok = await t.makeAdmin('Teacher P', 'adminpass123');
  const p = await t.call('POST', `/api/admin/students/${r.data.user.id}/placement`, { token: adminTok, body: { group_name: '2-guruh', day: 200 } });
  assert.equal(p.status, 200);
  assert.equal(p.data.student.group_name, '2-guruh');
  assert.equal(p.data.student.current_day, 200);
  assert.equal(p.data.student.level, 'pre-intermediate');
  assert.equal(p.data.student.placement_pending, false);
  assert.equal((await t.call('POST', `/api/admin/students/${r.data.user.id}/placement`, { token: adminTok, body: { group_name: 'zzz' } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${r.data.user.id}/placement`, { token: r.data.token, body: {} })).status, 403);
});

test('parolni o\'zgartirish: eski parol shart; yangi parol bilan kirish ishlaydi', async () => {
  const tok = await t.makeAdmin('Pass Admin', 'oldpass123');
  assert.equal((await t.call('POST', '/api/auth/change-password', { token: tok, body: { old_password: 'xxx', new_password: 'newpass123' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/change-password', { token: tok, body: { old_password: 'oldpass123', new_password: 'abc' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/change-password', { body: { old_password: 'oldpass123', new_password: 'newpass123' } })).status, 401);
  assert.equal((await t.call('POST', '/api/auth/change-password', { token: tok, body: { old_password: 'oldpass123', new_password: 'newpass123' } })).status, 200);
  assert.equal((await t.call('POST', '/api/auth/login', { body: { full_name: 'Pass Admin', password: 'oldpass123' } })).status, 401);
  assert.equal((await t.call('POST', '/api/auth/login', { body: { full_name: 'Pass Admin', password: 'newpass123' } })).status, 200);
});

test('o\'qituvchi ro\'yxatida yangi o\'quvchi belgisi (placement_pending) ko\'rinadi, o\'quvchiga emas', async () => {
  const reg = await t.call('POST', '/api/auth/register', { body: { full_name: 'Roster Kid', password: 'pass1234', level: 'elementary' } });
  const adminTok = await t.makeAdmin('Teacher R', 'adminpass123');
  const a = await t.call('GET', '/api/class/roster', { token: adminTok });
  assert.equal(a.data.students.find((s) => s.full_name === 'Roster Kid').placement_pending, true);
  const st = await t.call('GET', '/api/class/roster', { token: reg.data.token });
  assert.equal(st.data.students.find((s) => s.full_name === 'Roster Kid').placement_pending, undefined);
});

test('Writing: qotib qolmaslik — 2 marta urinishdan keyin 3+ so\'zli matn qabul qilinadi va o\'qituvchiga belgilanadi', async () => {
  const BookMaterial = require('../models/BookMaterial');
  const ExerciseProgress = require('../models/ExerciseProgress');
  await StudyPlan.create({ day_number: 31, unit_title: 'L', vocabulary: vocab });
  const s = await t.makeStudent('Lenient Kid');
  await User.updateOne({ full_name: 'Lenient Kid' }, { $set: { current_day: 31 } });
  const owner = await User.findOne({ role: 'admin' });
  const b = await BookMaterial.create({
    uploaded_by: owner._id, title: 'Journey', status: 'ready', assigned_day: 31, section_title: 'S',
    writing: { vocabulary: [{ word: 'make a journey', translation_uz: 'safar qilmoq' }, { word: 'a long journey', translation_uz: 'uzoq safar' }, { word: 'a bus journey', translation_uz: 'avtobus safari' }] },
  });
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  const wr = lesson.data.exercises.find((e) => e.kind === 'write');
  assert.deepEqual(wr.must_words, ['journey']);

  let r = await ans(s, 31, wr.key, 'I like trains');
  assert.equal(r.data.correct, false);
  assert.equal(r.data.task.tries_left, 1);
  r = await ans(s, 31, wr.key, 'I like buses');
  assert.equal(r.data.correct, false);
  assert.equal(r.data.task.tries_left, 0);
  assert.equal((await ans(s, 31, wr.key, 'Hi')).data.correct, false, '3 so\'zdan kam matn qabul qilinmaydi');
  r = await ans(s, 31, wr.key, 'I like trains');
  assert.equal(r.data.correct, true);
  const saved = await ExerciseProgress.findOne({ key: wr.key }).lean();
  assert.equal(saved.lenient, true);
  assert.equal(saved.first_try, true);
  await b.deleteOne();
});
