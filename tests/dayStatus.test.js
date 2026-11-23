const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const D = require('../lib/dayStatus');

const pts = (...dates) => ({ pts: Object.fromEntries(dates.map((d, i) => ['d' + i, { date: d, p: 5 }])) });
// 2026-11-16 = dushanba
const st = (o) => D.studentStatus({ group: null, today: '2026-11-16', hour: 12, ...o });

test('hafta kunlari va yakshanba dam', () => {
  assert.equal(D.weekdayOf('2026-11-16'), 1);
  assert.equal(D.weekdayOf('2026-11-22'), 7);
  assert.equal(D.isLessonDay(null, '2026-11-22'), false);
  assert.equal(D.isLessonDay(null, '2026-11-21'), true);
});
test('bugun bajardi -> done', () => assert.equal(st({ state: pts('2026-11-16') }).status, 'done'));
test('muddatgacha bajarmagan -> pending, muddatdan keyin -> missed', () => {
  assert.equal(st({ state: pts(), hour: 19 }).status, 'pending');
  assert.equal(st({ state: pts(), hour: 20 }).status, 'missed');
  assert.equal(st({ state: undefined, hour: 23 }).status, 'missed');
});
test('guruh muddati soati ishlaydi', () => {
  assert.equal(st({ group: { deadline_hour: 22 }, state: pts(), hour: 21 }).status, 'pending');
});
test('dam olish kuni qizil bo\'lmaydi', () => {
  const r = D.studentStatus({ group: null, state: pts(), today: '2026-11-22', hour: 23 });
  assert.equal(r.status, 'off');
});
test('"bugun dars yo\'q" -> off; qo\'shimcha dars yakshanbada -> missed', () => {
  assert.equal(st({ group: { off_dates: ['2026-11-16'] }, state: pts(), hour: 23 }).status, 'off');
  assert.equal(D.studentStatus({ group: { extra_dates: ['2026-11-22'] }, state: pts(), today: '2026-11-22', hour: 23 }).status, 'missed');
});
test('dam kunida bajarsa ham done (qo\'shimcha o\'qigan)', () => {
  assert.equal(D.studentStatus({ group: null, state: pts('2026-11-22'), today: '2026-11-22', hour: 10 }).status, 'done');
});
test('sababli kun', () => assert.equal(st({ state: pts(), excused_dates: ['2026-11-16'], hour: 22 }).status, 'excused'));
test('ketma-ket o\'tkazilgan dars kunlari yakshanbani sanamaydi', () => {
  // seshanba 17 = bugun; dushanba 16, shanba 14, juma 13 bajarmagan; yakshanba 15 dam; payshanba 12 bajargan
  const r = D.studentStatus({ group: null, state: pts('2026-11-12'), today: '2026-11-17', hour: 21 });
  assert.equal(r.status, 'missed');
  assert.equal(r.missed_in_row, 4); // 17, 16, 14, 13
});
test('sababli kun ketma-ketlikni sanamaydi, bajarilgan kun uzadi', () => {
  const r = D.studentStatus({ group: null, state: pts('2026-11-14'), excused_dates: ['2026-11-16'], today: '2026-11-17', hour: 21 });
  assert.equal(r.missed_in_row, 1);
});
test('yangi o\'quvchi: ro\'yxatdan oldingi kunlar sanalmaydi', () => {
  const r = D.studentStatus({ group: null, state: undefined, today: '2026-11-17', hour: 21, joined: '2026-11-17' });
  assert.equal(r.missed_in_row, 1);
});
test('bosqichlar soni: tugamagan kun', () => {
  const state = { d: { 4: { c: 1, s: { a: 1 } }, 5: { s: { a: 1, b: 1, c: 1 } } } };
  assert.equal(D.stepsInProgress(state), 3);
  assert.equal(D.stepsInProgress(null), 0);
});
test('toza qiymatlar', () => {
  assert.deepEqual(D.cleanLessonDays([1, 1, 9, 'x', 3]), [1, 3]);
  assert.equal(D.cleanLessonDays([]), null);
  assert.equal(D.cleanDeadlineHour(20), 20);
  assert.equal(D.cleanDeadlineHour(3), null);
  assert.equal(D.tashkentNow(new Date('2026-11-16T19:30:00Z')).date, '2026-11-17');
});

// ---- controller ----
const mkRes = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
function load(models) {
  const orig = Module._load;
  Module._load = function (req, ...a) {
    for (const k of Object.keys(models)) if (new RegExp('models/' + k + '$').test(req)) return models[k];
    if (/lib\/groups$/.test(req)) return { listGroups: async () => models.groupsList || [] };
    return orig.call(this, req, ...a);
  };
  delete require.cache[require.resolve('../controllers/statusController')];
  const c = require('../controllers/statusController');
  Module._load = orig;
  return c;
}
const chain = (v) => ({ select() { return this; }, lean: async () => v });
test('statusTable: qizil va yashil o\'quvchi, guruh hisobi', async () => {
  const today = D.tashkentNow().date;
  const hour = D.tashkentNow().hour;
  const A = 'a'.repeat(24), B = 'b'.repeat(24);
  const c = load({
    Group: {}, TestState: { find: () => chain([]) }, groupsList: [{ _id: 'g1', name: 'B1-2', deadline_hour: 8, lesson_days: [1, 2, 3, 4, 5, 6, 7] }],
    User: { find: () => chain([{ _id: A, full_name: 'Ali', group_name: 'B1-2', createdAt: '2020-01-01' }, { _id: B, full_name: 'Dilnoza', group_name: 'B1-2', createdAt: '2020-01-01' }]) },
    CourseState: { find: () => chain([{ user: A, state: { pts: { d1: { date: today, p: 5 } } } }]) },
  });
  const res = mkRes();
  await c.statusTable({}, res);
  const g = res.body.groups[0];
  assert.equal(g.students.find((s) => s.full_name === 'Ali').status, 'done');
  assert.equal(g.students.find((s) => s.full_name === 'Dilnoza').status, hour >= 8 ? 'missed' : 'pending');
  assert.equal(g.counts.done, 1);
  assert.equal(g.students[0].full_name, 'Dilnoza'); // qizil/kutayotgan birinchi
});
test('statusTable: Kids o\'quvchisi holati Kids logidan', async () => {
  const today = D.tashkentNow().date;
  const K = 'k'.repeat(24);
  const dayNum = Math.floor(Date.parse(today + 'T00:00:00Z') / 864e5);
  const c = load({
    Group: {}, TestState: { find: () => chain([]) }, groupsList: [{ _id: 'g1', name: 'Kids', deadline_hour: 8, lesson_days: [1, 2, 3, 4, 5, 6, 7] }],
    User: { find: () => chain([{ _id: K, full_name: 'Bola', group_name: 'Kids', createdAt: '2020-01-01', program: 'kids' }]) },
    CourseState: { find: () => chain([]) },
    KidsState: { find: () => chain([{ user: K, data: JSON.stringify({ log: { [dayNum]: 1 } }) }]) },
  });
  const res = mkRes();
  await c.statusTable({}, res);
  assert.equal(res.body.groups[0].students[0].status, 'done');
});
test('setOff: bugun dars yo\'q qo\'shadi va olib tashlaydi', async () => {
  const g = { off_dates: [], save: async () => {} };
  const c = load({ Group: { findById: async () => g }, User: {}, CourseState: {}, TestState: {} });
  const id = 'c'.repeat(24);
  let res = mkRes(); await c.setOff({ params: { id }, body: {} }, res);
  assert.equal(res.body.off, true); assert.equal(g.off_dates.length, 1);
  res = mkRes(); await c.setOff({ params: { id }, body: { off: false } }, res);
  assert.equal(g.off_dates.length, 0);
  res = mkRes(); await c.setOff({ params: { id }, body: { date: '2030-01-01' } }, res);
  assert.equal(res.code, 400);
});
test('setSchedule: noto\'g\'ri qiymat rad etiladi', async () => {
  const g = { save: async () => {} };
  const c = load({ Group: { findById: async () => g }, User: {}, CourseState: {}, TestState: {} });
  const id = 'c'.repeat(24);
  let res = mkRes(); await c.setSchedule({ params: { id }, body: { lesson_days: [] } }, res); assert.equal(res.code, 400);
  res = mkRes(); await c.setSchedule({ params: { id }, body: { deadline_hour: 3 } }, res); assert.equal(res.code, 400);
  res = mkRes(); await c.setSchedule({ params: { id }, body: { lesson_days: [1, 3, 5], deadline_hour: 21 } }, res);
  assert.deepEqual(g.lesson_days, [1, 3, 5]); assert.equal(g.deadline_hour, 21);
});
