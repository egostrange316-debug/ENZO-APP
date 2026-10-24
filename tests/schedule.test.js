const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, StudyPlan, User } = require('./helpers');
const BookMaterial = require('../models/BookMaterial');

let t, admin, s1;
before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  s1 = await t.makeStudent('Jadval Bola', 'pass1234', '1-guruh');
  const adm = await User.findOne({ role: 'admin' });
  await StudyPlan.create({ day_number: 1, unit_title: 'Oila' });
  await BookMaterial.create({
    uploaded_by: adm._id, title: '1-unit', section_title: 'The family', status: 'ready', assigned_day: 1,
    book_ref: { book: 'EVIU', label: 'EVIU, 1-unit (1-qism)' },
    writing: { vocabulary: [{ word: 'mother', translation_uz: 'ona' }], grammar: [{ title: 'to be', title_uz: "bo'lmoq", explanation_uz: 'izoh', exercises: [] }] },
  });
});
after(async () => { await t.teardown(); });

test('kurs jadvali: 646 kun, imtihon kunlari belgilangan, o\'quvchi ham ko\'radi, to\'lov ma\'lumoti yo\'q', async () => {
  const a = await t.call('GET', '/api/admin/schedule', { token: admin });
  assert.equal(a.status, 200);
  assert.equal(a.data.days.length, 646);
  assert.equal(a.data.days[0].book_ref, '1-unit (1-qism)');
  assert.equal(a.data.days[0].grammar, "to be — bo'lmoq");
  assert.equal(a.data.days[0].students_here, 1);
  assert.equal(a.data.days[6].type, 'mini_check');
  assert.equal(a.data.days[69].type, 'final_exam');
  assert.deepEqual(a.data.levels.map((l) => l.total), [70, 70, 154, 170, 182]);
  const s = await t.call('GET', '/api/student/schedule', { token: s1.token });
  assert.equal(s.status, 200);
  assert.equal(s.data.current_day, 1);
  assert.ok(!JSON.stringify(s.data).match(/payment|amount|subscription/i));
  assert.equal((await t.call('GET', '/api/admin/schedule', { token: s1.token })).status, 403);
});

test('naqd to\'lov jadvali: summa va izoh saqlanadi, jami hisoblanadi, o\'quvchi ko\'ra olmaydi', async () => {
  const bad = await t.call('POST', `/api/admin/students/${s1.user.id}/pay`, { token: admin, body: { months: 2, amount: -5 } });
  assert.equal(bad.status, 400);
  const ok = await t.call('POST', `/api/admin/students/${s1.user.id}/pay`, { token: admin, body: { months: 2, amount: 300000, note: 'naqd' } });
  assert.equal(ok.status, 200);
  const r = await t.call('GET', '/api/admin/payments', { token: admin });
  assert.equal(r.status, 200);
  const row = r.data.rows.find((x) => x.full_name === 'Jadval Bola');
  assert.equal(row.last_payment.amount, 300000);
  assert.equal(row.last_payment.note, 'naqd');
  assert.equal(row.total_paid, 300000);
  assert.equal(row.state, 'paid');
  assert.equal(r.data.summary.collected_this_month, 300000);
  assert.equal((await t.call('GET', '/api/admin/payments', { token: s1.token })).status, 403);
  const me = await t.call('GET', '/api/student/me', { token: s1.token });
  assert.ok(!JSON.stringify(me.data).includes('300000'));
});
