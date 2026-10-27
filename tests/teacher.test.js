const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, vocab, StudyPlan, User } = require('./helpers');
const BookMaterial = require('../models/BookMaterial');

let t, admin, s1, s2, book;
before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  s1 = await t.makeStudent('Birinchi Bola', 'pass1234', '1-guruh');
  s2 = await t.makeStudent('Ikkinchi Bola', 'pass1234', '1-guruh');
  const adm = await User.findOne({ role: 'admin' });
  await StudyPlan.create({ day_number: 1, unit_title: 'Oila' });
  book = await BookMaterial.create({
    uploaded_by: adm._id, title: '1-unit', status: 'ready', assigned_day: 1,
    book_ref: { book: 'EVIU', unit: 1, label: 'English Vocabulary in Use: Elementary, 1-unit (1-qism)' },
    writing: { vocabulary: [
      { word: 'mother', translation_uz: 'ona', example_sentence: 'My mother cooks.' },
      { word: 'father', translation_uz: 'ota', example_sentence: 'My father drives.' },
    ], grammar: [{ title: 'to be', title_uz: 'bo\'lmoq', explanation_uz: 'izoh', forms: ['I am', 'you are'], examples: [], exercises: [] }] },
  });
});
after(async () => { await t.teardown(); });

test('bugungi mavzu paneli: kun, kitobdagi joy, grammatika va o\'quvchilar; o\'quvchi kira olmaydi', async () => {
  await User.updateOne({ _id: s2.user.id }, { current_day: 7 });
  const r = await t.call('GET', '/api/admin/today', { token: admin });
  assert.equal(r.status, 200);
  const g1 = r.data.groups.find((g) => g.day === 1);
  assert.equal(g1.students.length, 1);
  assert.equal(g1.level, 'beginner');
  assert.equal(g1.level_label, 'A1');
  assert.match(g1.book_ref.label, /bet/);
  assert.equal(g1.grammar.title, 'G01 · To be: am / is / are');
  const g7 = r.data.groups.find((g) => g.day === 7);
  assert.equal(g7.lesson_type, 'regular');
  assert.equal(r.data.levels.length, 5);
  assert.deepEqual(r.data.levels.map((l) => l.label), ['A1', 'A2', 'B1', 'B2', 'C1']);
  assert.equal((await t.call('GET', '/api/admin/today', { token: s1.token })).status, 403);
});

test('tarjimani tahrirlash: saqlanadi, dublikat/kirill/noto\'g\'ri indeks rad etiladi, o\'quvchi qila olmaydi', async () => {
  const ok = await t.call('PATCH', `/api/admin/books/${book._id}/vocab`, { token: admin, body: { edits: [{ index: 0, translation_uz: 'onajon' }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.vocabulary[0].translation_uz, 'onajon');
  assert.equal((await BookMaterial.findById(book._id)).teacher_edited, true);
  assert.equal((await t.call('PATCH', `/api/admin/books/${book._id}/vocab`, { token: admin, body: { edits: [{ index: 1, translation_uz: 'onajon' }] } })).status, 409);
  assert.equal((await t.call('PATCH', `/api/admin/books/${book._id}/vocab`, { token: admin, body: { edits: [{ index: 1, translation_uz: 'отa' }] } })).status, 400);
  assert.equal((await t.call('PATCH', `/api/admin/books/${book._id}/vocab`, { token: admin, body: { edits: [{ index: 9, translation_uz: 'x' }] } })).status, 400);
  assert.equal((await t.call('PATCH', `/api/admin/books/${book._id}/vocab`, { token: s1.token, body: { edits: [{ index: 0, translation_uz: 'x' }] } })).status, 403);
  const c = await t.call('GET', `/api/admin/books/${book._id}/content`, { token: admin });
  assert.equal(c.data.vocabulary[0].translation_uz, 'onajon');
  assert.equal(c.data.teacher_edited, true);
});
