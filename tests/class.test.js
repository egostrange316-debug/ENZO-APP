const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, User } = require('./helpers');
const Homework = require('../models/Homework');
const { UPLOAD_DIR } = require('../lib/imageUpload');

let t, admin, a, b, c;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const today = new Date().toISOString().slice(0, 10);
const hrs = (h) => new Date(Date.now() + h * 3600000).toISOString();

before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  a = await t.makeStudent('Ali Valiyev');
  b = await t.makeStudent('Bobur Karimov');
  c = await t.makeStudent('Chet Guruh', 'pass1234', '2-guruh');
});
after(async () => { await t.teardown(); });

test('roster: o\'quvchi ro\'yxati to\'lov/blok ma\'lumotisiz; admin blok holatini ko\'radi', async () => {
  const r = await t.call('GET', '/api/class/roster', { token: a.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.students.length, 3);
  assert.equal(r.data.students[0].blocked, undefined);
  assert.equal(JSON.stringify(r.data).includes('subscription'), false);
  const ar = await t.call('GET', '/api/class/roster', { token: admin });
  assert.equal(typeof ar.data.students[0].blocked, 'boolean');
  assert.equal((await t.call('GET', '/api/class/roster')).status, 401);
  await User.updateOne({ full_name: 'Bobur Karimov' }, { $set: { xp: 30, ball: 5 } });
  const top = (await t.call('GET', '/api/class/roster', { token: a.token })).data.students[0];
  assert.equal(top.full_name, 'Bobur Karimov');
  assert.equal(top.ball, 35);
  await User.updateOne({ full_name: 'Bobur Karimov' }, { $set: { xp: 0, ball: 0 } });
});

test('bloklangan o\'quvchi sinf ma\'lumotlarini ola olmaydi', async () => {
  await User.updateOne({ full_name: 'Chet Guruh' }, { $set: { status: 'blocked' } });
  assert.equal((await t.call('GET', '/api/class/roster', { token: c.token })).status, 403);
  await User.updateOne({ full_name: 'Chet Guruh' }, { $set: { status: 'active' } });
});

test('davomat: admin belgilaydi, o\'z guruhi ko\'radi, o\'quvchi belgilay olmaydi', async () => {
  const body = { student_id: a.user.id, date: today, status: 'present' };
  assert.equal((await t.call('PUT', '/api/class/attendance', { token: a.token, body })).status, 403);
  assert.equal((await t.call('PUT', '/api/class/attendance', { token: admin, body })).status, 200);
  assert.equal((await t.call('PUT', '/api/class/attendance', { token: admin, body: { ...body, status: 'absent' } })).status, 200); // almashadi
  assert.equal((await t.call('PUT', '/api/class/attendance', { token: admin, body: { ...body, status: 'x' } })).status, 400);
  assert.equal((await t.call('PUT', '/api/class/attendance', { token: admin, body: { ...body, date: '2026-1-1' } })).status, 400);
  await t.call('PUT', '/api/class/attendance', { token: admin, body: { student_id: c.user.id, date: today, status: 'present' } });
  const mine = await t.call('GET', '/api/class/attendance', { token: b.token });
  assert.equal(mine.data.attendance.length, 1);
  assert.equal(mine.data.attendance[0].status, 'absent');
  assert.equal(mine.data.attendance[0].student_id, a.user.id);
  const all = await t.call('GET', '/api/class/attendance', { token: admin });
  assert.equal(all.data.attendance.length, 2);
  const g2 = await t.call('GET', '/api/class/attendance?group=2-guruh', { token: admin });
  assert.equal(g2.data.attendance.length, 1);
  await t.call('PUT', '/api/class/attendance', { token: admin, body: { ...body, status: 'clear' } });
  assert.equal((await t.call('GET', '/api/class/attendance', { token: b.token })).data.attendance.length, 0);
});

let hwId;
test('uy vazifasi: yaratish tekshiruvi va guruhga ko\'rinishi', async () => {
  assert.equal((await t.call('POST', '/api/class/homework', { token: a.token, body: {} })).status, 403);
  assert.equal((await t.call('POST', '/api/class/homework', { token: admin, body: { group_name: '1-guruh', title: 'X', starts_at: hrs(2), ends_at: hrs(1) } })).status, 400);
  const r = await t.call('POST', '/api/class/homework', { token: admin, body: { group_name: '1-guruh', title: 'Unit 1 yozish', starts_at: hrs(-1), ends_at: hrs(24), reward_ball: 10, penalty_ball: 5 } });
  assert.equal(r.status, 201);
  hwId = r.data.homework.id;
  assert.equal((await t.call('GET', '/api/class/homework', { token: a.token })).data.homeworks.length, 1);
  assert.equal((await t.call('GET', '/api/class/homework', { token: c.token })).data.homeworks.length, 0); // boshqa guruh
});

test('topshirish: faqat rasm, o\'z vaqtida mukofot BIR marta, boshqa guruh topshira olmaydi', async () => {
  const bad = await t.form('POST', `/api/class/homework/${hwId}/submit`, { token: a.token, parts: [{ name: 'file', bytes: Buffer.from('<html>x</html>'.repeat(5)), type: 'image/png', filename: 'x.png' }] });
  assert.equal(bad.status, 400);
  const png = [{ name: 'file', bytes: PNG, type: 'image/png', filename: 'hw.png' }];
  assert.equal((await t.form('POST', `/api/class/homework/${hwId}/submit`, { token: c.token, parts: png })).status, 404);
  const ok = await t.form('POST', `/api/class/homework/${hwId}/submit`, { token: a.token, parts: png });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.rewarded, 10);
  assert.match(ok.data.image_url, /^\/uploads\/hw-[0-9a-f]{24}\.png$/);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, path.basename(ok.data.image_url))));
  const again = await t.form('POST', `/api/class/homework/${hwId}/submit`, { token: a.token, parts: png });
  assert.equal(again.data.rewarded, 0);
  assert.equal((await User.findOne({ full_name: 'Ali Valiyev' })).ball, 10);
});

test('muddat o\'tgach topshirmaganga jarima bir martagina; ball 0 dan pastga tushmaydi', async () => {
  await User.updateOne({ full_name: 'Bobur Karimov' }, { $set: { ball: 3 } });
  await Homework.updateOne({ _id: hwId }, { $set: { ends_at: new Date(Date.now() - 1000) } });
  const r1 = await t.call('GET', '/api/class/homework', { token: b.token });
  assert.equal(r1.data.submissions.length, 1);
  assert.equal(r1.data.submissions[0].submitted, false);
  await t.call('GET', '/api/class/homework', { token: admin });
  await t.call('GET', '/api/class/homework', { token: b.token });
  assert.equal((await User.findOne({ full_name: 'Bobur Karimov' })).ball, 0); // 3-5 -> 0
  assert.equal((await User.findOne({ full_name: 'Ali Valiyev' })).ball, 10); // topshirgan, jarima yo'q
  const adm = await t.call('GET', '/api/class/homework', { token: admin });
  assert.equal(adm.data.submissions.length, 2);
  // kech topshirish: mukofot yo'q
  const late = await t.form('POST', `/api/class/homework/${hwId}/submit`, { token: b.token, parts: [{ name: 'file', bytes: PNG, type: 'image/png', filename: 'l.png' }] });
  assert.equal(late.data.on_time, false);
  assert.equal(late.data.rewarded, 0);
});

test('vazifani o\'chirish topshiriqlarni ham o\'chiradi', async () => {
  assert.equal((await t.call('DELETE', `/api/class/homework/${hwId}`, { token: admin })).status, 200);
  assert.equal((await t.call('GET', '/api/class/homework', { token: admin })).data.submissions.length, 0);
});

test('xabarlar: yuborish, faqat o\'ziniki ko\'rinadi, tekshiruvlar', async () => {
  const s = await t.call('POST', '/api/class/messages', { token: a.token, body: { to: b.user.id, body: '  Salom!  ' } });
  assert.equal(s.status, 201);
  assert.equal(s.data.message.body, 'Salom!');
  assert.equal((await t.call('POST', '/api/class/messages', { token: a.token, body: { to: a.user.id, body: 'x' } })).status, 400);
  assert.equal((await t.call('POST', '/api/class/messages', { token: a.token, body: { to: b.user.id, body: '   ' } })).status, 400);
  assert.equal((await t.call('POST', '/api/class/messages', { token: a.token, body: { to: 'zzz', body: 'x' } })).status, 400);
  assert.equal((await t.call('GET', '/api/class/messages', { token: b.token })).data.messages.length, 1);
  assert.equal((await t.call('GET', '/api/class/messages', { token: c.token })).data.messages.length, 0);
});

test('avatar: rasm saqlanadi va profilda ko\'rinadi; rasm bo\'lmagan fayl rad etiladi', async () => {
  const bad = await t.form('POST', '/api/class/avatar', { token: a.token, parts: [{ name: 'file', bytes: Buffer.from('not an image at all, really'), type: 'image/png', filename: 'a.png' }] });
  assert.equal(bad.status, 400);
  const ok = await t.form('POST', '/api/class/avatar', { token: a.token, parts: [{ name: 'file', bytes: PNG, type: 'image/png', filename: 'a.png' }] });
  assert.equal(ok.status, 200);
  const r = await t.call('GET', '/api/class/roster', { token: b.token });
  assert.equal(r.data.students.find((s) => s.id === a.user.id).avatar, ok.data.avatar);
});

test('o\'quvchi o\'chirilsa davomat, topshiriq va xabarlari ham o\'chadi', async () => {
  await t.call('PUT', '/api/class/attendance', { token: admin, body: { student_id: b.user.id, date: today, status: 'present' } });
  assert.equal((await t.call('DELETE', `/api/admin/students/${b.user.id}`, { token: admin })).status, 200);
  assert.equal((await t.call('GET', '/api/class/attendance', { token: admin })).data.attendance.filter((x) => x.student_id === b.user.id).length, 0);
  assert.equal((await t.call('GET', '/api/class/messages', { token: a.token })).data.messages.length, 0);
});

test('natijalar jadvali: hamma raqamlar ochiq, to\'lov faqat adminga', async () => {
  const DayMastery = require('../models/DayMastery');
  const Attendance = require('../models/Attendance');
  await DayMastery.create({ user: (await User.findOne({ full_name: 'Ali Valiyev' }))._id, day_number: 1, passes: 1, last_percent: 80 });
  const st = await t.call('GET', '/api/class/table', { token: a.token });
  assert.equal(st.status, 200);
  assert.ok(st.data.students.length >= 2);
  assert.equal(JSON.stringify(st.data).includes('payment'), false);
  assert.equal(JSON.stringify(st.data).includes('subscription'), false);
  const me = st.data.students.find((s) => s.full_name === 'Ali Valiyev');
  assert.equal(me.accuracy, 80);
  assert.equal(me.group_name, '1-guruh');
  assert.equal(typeof me.course_percent, 'number');
  const ad = await t.call('GET', '/api/class/table', { token: admin });
  assert.equal(ad.data.students[0].payment.state.length > 0, true);
  assert.equal((await t.call('GET', '/api/class/table')).status, 401);
  await DayMastery.deleteMany({});
});
