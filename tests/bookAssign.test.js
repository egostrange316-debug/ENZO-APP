const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, vocab, StudyPlan, User } = require('./helpers');
const BookMaterial = require('../models/BookMaterial');
const { goodBook } = require('./fakeGemini');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.teardown(); });

async function makeBook(adminId, over = {}) {
  const g = goodBook();
  return BookMaterial.create({
    uploaded_by: adminId, title: 'Unit 5 kitob', status: 'ready',
    writing: g.writing, reading: g.reading, listening: g.listening, speaking: g.speaking, ...over,
  });
}
const ans = (s, day, key, answer) => t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: day, key, answer } });

test('kitobni kunga biriktirish: tekshiruvlar (imtihon kuni, noto\'g\'ri kun, tayyor emas, ruxsat)', async () => {
  const admin = await t.makeAdmin('Book Admin');
  const adminUser = await User.findOne({ role: 'admin' });
  const book = await makeBook(adminUser._id);
  const s = await t.makeStudent('Not Admin Kid');
  const url = `/api/admin/books/${book._id}/assign`;

  assert.equal((await t.call('POST', url, { token: s.token, body: { day_number: 2 } })).status, 403);
  assert.equal((await t.call('POST', url, { token: admin, body: { day_number: 7 } })).status, 400, '7-kun imtihon');
  assert.equal((await t.call('POST', url, { token: admin, body: { day_number: 70 } })).status, 400);
  assert.equal((await t.call('POST', url, { token: admin, body: { day_number: 647 } })).status, 400);
  assert.equal((await t.call('POST', url, { token: admin, body: { day_number: 'x' } })).status, 400);
  const failed = await makeBook(adminUser._id, { status: 'failed' });
  assert.equal((await t.call('POST', `/api/admin/books/${failed._id}/assign`, { token: admin, body: { day_number: 2 } })).status, 409);

  const ok = await t.call('POST', url, { token: admin, body: { day_number: 2 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.book.assigned_day, 2);
  assert.ok(await StudyPlan.exists({ day_number: 2 }), 'reja yo\'q bo\'lsa avtomatik yaratiladi');
  const list = await t.call('GET', '/api/admin/books', { token: admin });
  assert.equal(list.data.books.find((b) => b.id === String(book._id)).assigned_day, 2);

  const un = await t.call('POST', url, { token: admin, body: { day_number: null } });
  assert.equal(un.data.book.assigned_day, null);
});

test('biriktirilgan kitob darsda chiqadi; mashqlar javobsiz; hammasi to\'g\'ri bo\'lmaguncha kun yakunlanmaydi; foiz', async () => {
  const admin = await t.makeAdmin('Book Admin 2');
  const adminUser = await User.findOne({ name_key: 'book admin 2' });
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(1) });
  const book = await makeBook(adminUser._id);
  assert.equal((await t.call('POST', `/api/admin/books/${book._id}/assign`, { token: admin, body: { day_number: 1 } })).status, 200);
  const id6 = String(book._id).slice(-6);

  const s = await t.makeStudent('Book Kid');
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.status, 200);
  const raw = JSON.stringify(lesson.data);
  assert.ok(!/correct_answer_index|correct_word|correct_index/.test(raw), 'javob sizib chiqdi');

  // 1 reja testi + lug'at 8x2 + grammatika 2 + reading 5 + listening 5 + diktant 3 + writing 1 + speaking 1 = 34
  assert.equal(lesson.data.exercises.length, 34);
  assert.equal(lesson.data.book_sections.length, 1);
  const bs = lesson.data.book_sections[0];
  assert.equal(bs.writing.vocabulary.length, 8);
  assert.ok(bs.reading.text.includes('Anna'));
  assert.ok(bs.listening.script.includes('Tom'));
  assert.equal(bs.speaking.questions.length, 6);
  const sections = new Set(lesson.data.exercises.map((e) => e.section));
  assert.deepEqual([...sections].sort(), ['dictation', 'grammar', 'quiz', 'reading', 'listening', 'vocab', 'writing', 'speaking'].sort());
  const dict = lesson.data.exercises.find((e) => e.section === 'dictation');
  assert.ok(dict.speak_text, 'diktant matni TTS uchun beriladi');

  // Hammasini to'g'ri bajarmasdan yakunlab bo'lmaydi
  assert.equal((await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } })).status, 409);

  // goodBook: grammatika #1 'goes', #2 'play'; reading to'g'ri = i%4; listening = (i+1)%4; diktant: 3 gap
  const answers = [['q:0', 0], [`b${id6}:g0:0`, 'goes'], [`b${id6}:g0:1`, 'play']];
  for (let i = 0; i < 5; i++) answers.push([`b${id6}:r:${i}`, i % 4], [`b${id6}:l:${i}`, (i + 1) % 4]);
  const sentences = ['Tom wakes up early.', 'He eats breakfast.', 'They go to school.'];
  sentences.forEach((x, i) => answers.push([`b${id6}:d:${i}`, i === 0 ? 'tom wakes up early' : x])); // tinish belgisiz ham to'g'ri

  // Writing (bugungi so'zlar bilan matn) va Speaking (aytdim)
  const wr = lesson.data.exercises.find((x) => x.kind === 'write');
  answers.push([wr.key, `${wr.must_words.join(' and ')} are my words today and I like them`]);
  answers.push([lesson.data.exercises.find((x) => x.kind === 'speak').key, 'I like it']);

  // Lug'at mashqlari: EN->UZ tanlash va UZ->EN yozish (kalitlar bo'yicha)
  const gv = goodBook().writing.vocabulary;
  for (const e of lesson.data.exercises.filter((x) => x.section === 'vocab')) {
    if (e.kind === 'mcq') {
      const w = e.question.match(/"(.+?)"/)[1];
      const tr = gv.find((v) => v.word === w).translation_uz;
      answers.push([e.key, e.options.indexOf(tr)]);
    } else {
      const tr = e.question.split(': ')[1];
      answers.push([e.key, gv.find((v) => v.translation_uz === tr).word]);
    }
  }

  // Dastlab bitta xato qilib ko'ramiz (cheklovsiz takrorlanadi)
  assert.equal((await ans(s, 1, `b${id6}:r:0`, 3)).data.correct, false);
  let last;
  for (const [key, a] of answers) {
    last = await ans(s, 1, key, a);
    assert.equal(last.data.correct, true, `${key} to'g'ri bo'lishi kerak`);
  }
  assert.equal(last.data.progress.percent, 100);
  assert.equal(last.data.progress.total, 34);
  assert.equal(last.data.progress.first_try_percent, 97); // 33/34 birinchi urinishda

  const done = await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } });
  assert.equal(done.status, 200);
  assert.equal(done.data.new_current_day, 2);

  // Takrorlash: kitob kontenti va mashqlar yana mavjud
  const rev = await t.call('GET', '/api/student/lesson/day/1', { token: s.token });
  assert.equal(rev.data.exercises.length, 34);
  assert.equal(rev.data.book_sections.length, 1);
});

test('tayyor bo\'lmagan (failed/processing) kitob darsda ko\'rinmaydi; biriktirish bekor qilinsa mashqlar yo\'qoladi', async () => {
  const admin = await t.makeAdmin('Book Admin 3');
  const adminUser = await User.findOne({ name_key: 'book admin 3' });
  await StudyPlan.create({ day_number: 4, unit_title: 'U4', vocabulary: vocab, quizzes: quiz(1) });
  const hidden = await makeBook(adminUser._id, { status: 'processing', assigned_day: 4 });
  const s = await t.makeStudent('Hidden Book Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 4 });
  const l = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  const own = (r) => r.data.exercises.filter((e) => !String(e.group || '').startsWith('Takrorlash'));
  assert.equal(own(l).length, 1);
  assert.equal(l.data.book_sections.length, 0);

  const ready = await makeBook(adminUser._id);
  await t.call('POST', `/api/admin/books/${ready._id}/assign`, { token: admin, body: { day_number: 4 } });
  assert.equal(own(await t.call('GET', '/api/student/lesson/today', { token: s.token })).length, 34);
  await t.call('POST', `/api/admin/books/${ready._id}/assign`, { token: admin, body: { day_number: null } });
  assert.equal(own(await t.call('GET', '/api/student/lesson/today', { token: s.token })).length, 1);
  void hidden;
});
