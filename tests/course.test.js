const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, User } = require('./helpers');

let t, admin, a;
before(async () => { t = await setup(); admin = await t.makeAdmin(); a = await t.makeStudent('Ali Valiyev'); });
after(async () => { await t.teardown(); });

test('kurs: sinxronlash birlashtiradi va jadvalga ball/kun tushadi', async () => {
  const s1 = { u: 1, d: { 0: { c: 1, t: 90 } }, pts: { d0: { date: '2026-10-20', p: 12 } } };
  const r1 = await t.call('PUT', '/api/student/course', { token: a.token, body: { state: s1 } });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.summary.points, 12);
  const s2 = { u: 2, d: { 1: { c: 1, t: 70 } }, pts: { d1: { date: '2026-10-21', p: 8 } } };
  const r2 = await t.call('PUT', '/api/student/course', { token: a.token, body: { state: s2 } });
  assert.equal(r2.data.summary.days_done, 2);
  assert.equal(r2.data.summary.points, 20);
  const g = await t.call('GET', '/api/student/course', { token: a.token });
  assert.equal(g.data.state.d[0].c, 1);
  const tb = await t.call('GET', '/api/class/table', { token: admin });
  const row = tb.data.students.find((x) => x.full_name === 'Ali Valiyev');
  assert.equal(row.course_days_done, 2);
  assert.equal(row.ball, 20);
  assert.equal((await t.call('PUT', '/api/student/course', { body: { state: s1 } })).status, 401);
  assert.equal((await t.call('PUT', '/api/student/course', { token: a.token, body: { state: 5 } })).status, 400);
});

test('bloklangan o\'quvchi kursni sinxronlay olmaydi', async () => {
  await User.updateOne({ full_name: 'Ali Valiyev' }, { $set: { status: 'blocked' } });
  const r = await t.call('PUT', '/api/student/course', { token: a.token, body: { state: { u: 0 } } });
  assert.equal(r.status, 403);
  await User.updateOne({ full_name: 'Ali Valiyev' }, { $set: { status: 'active' } });
});

test('davomat: kechikdi/sababli va oflayn paket (bulk) takror yuborilsa ham xavfsiz', async () => {
  const id = (await User.findOne({ full_name: 'Ali Valiyev' }))._id.toString();
  const marks = [{ student_id: id, date: '2026-10-20', status: 'present' }, { student_id: id, date: '2026-10-22', status: 'late' }, { student_id: id, date: '2026-10-23', status: 'excused' }, { student_id: 'bad', date: '2026-10-23', status: 'present' }];
  const r = await t.call('POST', '/api/class/attendance/bulk', { token: admin, body: { marks } });
  assert.equal(r.status, 200);
  assert.equal(r.data.saved, 3);
  assert.equal(r.data.skipped, 1);
  await t.call('POST', '/api/class/attendance/bulk', { token: admin, body: { marks } });
  const att = await t.call('GET', '/api/class/attendance', { token: admin });
  assert.equal(att.data.attendance.filter((x) => x.student_id === id).length, 3);
  assert.equal((await t.call('POST', '/api/class/attendance/bulk', { token: a.token, body: { marks } })).status, 403);
});
