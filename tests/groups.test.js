const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, User } = require('./helpers');

let t, admin, s1, s2;
before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  s1 = await t.makeStudent('Guruh Bola', 'pass1234', '1-guruh');
  s2 = await t.makeStudent('Guruh Qiz', 'pass1234', '2-guruh');
});
after(async () => { await t.teardown(); });

test('guruhlar: ochiq ro\'yxat, admin yaratadi/nomini o\'zgartiradi/o\'chiradi; o\'quvchi qila olmaydi', async () => {
  const pub = await t.call('GET', '/api/auth/groups');
  assert.deepEqual(pub.data.groups.slice(0, 2), ['1-guruh', '2-guruh']);
  assert.equal((await t.call('GET', '/api/admin/groups', { token: s1.token })).status, 403);

  const c = await t.call('POST', '/api/admin/groups', { token: admin, body: { name: 'Kechki guruh' } });
  assert.equal(c.status, 201);
  assert.equal((await t.call('POST', '/api/admin/groups', { token: admin, body: { name: 'kechki  GURUH' } })).status, 409);
  const id = c.data.groups.find((g) => g.name === 'Kechki guruh').id;

  const r = await t.call('PATCH', `/api/admin/groups/${id}`, { token: admin, body: { name: 'Tungi guruh' } });
  assert.equal(r.status, 200);
  const reg = await t.call('POST', '/api/auth/register', { body: { full_name: 'Tungi Bola', password: 'pass1234', group_name: 'Tungi guruh' } });
  assert.equal(reg.status, 201);
  assert.equal((await t.call('POST', '/api/auth/register', { body: { full_name: 'Yomon Bola', password: 'pass1234', group_name: 'Kechki guruh' } })).status, 400);

  const del = await t.call('DELETE', `/api/admin/groups/${id}?move_to=1-guruh`, { token: admin });
  assert.equal(del.status, 200);
  assert.equal((await User.findOne({ full_name: 'Tungi Bola' })).group_name, '1-guruh');
});

test('guruhga ko\'chirish: bir nechta o\'quvchi, noto\'g\'ri guruh/id rad etiladi', async () => {
  const ids = [s1.user.id, s2.user.id];
  const m = await t.call('POST', '/api/admin/groups/move', { token: admin, body: { student_ids: ids, to: '3-guruh' } });
  assert.equal(m.status, 200);
  assert.equal((await User.findById(s2.user.id)).group_name, '3-guruh');
  assert.equal((await t.call('POST', '/api/admin/groups/move', { token: admin, body: { student_ids: ids, to: 'yo\'q' } })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/groups/move', { token: admin, body: { student_ids: ['x'], to: '' } })).status, 400);
  await t.call('POST', '/api/admin/groups/move', { token: admin, body: { student_ids: ids, to: '' } });
  assert.equal((await User.findById(s1.user.id)).group_name, null);
});
