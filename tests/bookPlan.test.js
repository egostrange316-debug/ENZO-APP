process.env.BOOK_PLANS_PER_HOUR = '1000';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.GEMINI_FILE_POLL_MS = '10';
process.env.GEMINI_RETRY_MS = '10';
process.env.BOOK_UPLOAD_DIR = require('path').join(require('os').tmpdir(), `plan-test-${process.pid}`);

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { setup } = require('./helpers');
const { startFakeGemini } = require('./fakeGemini');
const BookMaterial = require('../models/BookMaterial');
const BookPlan = require('../models/BookPlan');
const { queue } = require('../controllers/bookController');
const { regularDaysOfLevel } = require('../controllers/bookPlanController');
const { splitCounts, planParts } = require('../lib/pdfSplit');

let t, admin, gem, pdfBytes;

async function startGem(opts) {
  if (gem) await gem.close();
  gem = await startFakeGemini(opts);
  process.env.GEMINI_BASE_URL = gem.url;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPlan(id) {
  for (let i = 0; i < 200; i++) {
    const p = await BookPlan.findById(id).lean();
    const n = await BookMaterial.countDocuments({ plan: id });
    if (p.status === 'failed' || (p.status === 'running' && n === p.total_sets)) break;
    await sleep(25);
  }
  await sleep(50);
  await queue.onIdle();
}
const planBody = (over = {}) => ({
  title: 'Key Words Test',
  level: 'pre-intermediate',
  page_offset: '1',
  sections: JSON.stringify([
    { title: 'Section 1', from_page: 3, to_page: 9, days: 3 },
    { title: 'Section 2', from_page: 10, to_page: 14, days: 2 },
  ]),
  ...over,
});
const post = (fields) =>
  t.form('POST', '/api/admin/book-plans', { token: admin, parts: [{ name: 'file', type: 'application/pdf', bytes: pdfBytes, filename: 'book.pdf' }], fields });

before(async () => {
  t = await setup();
  admin = await t.makeAdmin('Plan Admin');
  const doc = await PDFDocument.create();
  for (let i = 0; i < 30; i++) doc.addPage();
  pdfBytes = Buffer.from(await doc.save());
});
after(async () => {
  if (gem) await gem.close();
  await t.teardown();
});
beforeEach(async () => { await startGem(); });

test('birlik: sahifalarni teng bo\'lish va reja qismlari', () => {
  assert.deepEqual(splitCounts(7, 3), [3, 2, 2]);
  assert.deepEqual(splitCounts(5, 2), [3, 2]);
  assert.deepEqual(splitCounts(3, 5), [1, 1, 1], 'kunlar sahifadan ko\'p bo\'lsa sahifa soniga tushadi');
  assert.deepEqual(splitCounts(145, 58).reduce((a, b) => a + b), 145);
  const parts = planParts([{ title: 'S', from_page: 10, to_page: 16, days: 3 }]);
  assert.deepEqual(parts.map((p) => [p.from, p.to]), [[10, 12], [13, 14], [15, 16]]);
  // har darajadagi oddiy kunlar soni
  const counts = { beginner: 60, elementary: 60, 'pre-intermediate': 132, intermediate: 148, 'upper-intermediate': 156 };
  for (const [l, n] of Object.entries(counts)) assert.equal(regularDaysOfLevel(l).length, n);
});

test('ruxsat va tekshiruvlar', async () => {
  const s = await t.makeStudent('Plan Student');
  assert.equal((await t.form('POST', '/api/admin/book-plans', { token: s.token, parts: [] })).status, 403);
  assert.equal((await t.form('POST', '/api/admin/book-plans', { token: admin })).status, 400, 'fayl yo\'q');
  const fake = await t.form('POST', '/api/admin/book-plans', { token: admin, parts: [{ name: 'file', type: 'application/pdf', bytes: Buffer.from('matn matn matn'), filename: 'x.pdf' }], fields: planBody() });
  assert.equal(fake.status, 400);
  assert.equal((await post(planBody({ level: 'advanced' }))).status, 400);
  assert.equal((await post(planBody({ title: ' ' }))).status, 400);
  assert.equal((await post(planBody({ sections: 'nojson' }))).status, 400);
  assert.equal((await post(planBody({ sections: JSON.stringify([{ title: 'x', from_page: 9, to_page: 3, days: 2 }]) }))).status, 400);
  assert.equal((await post(planBody({ page_offset: 'abc' }))).status, 400);
  assert.equal(gem.calls.uploads.length, 0);
});

test('reja: PDF kesiladi, har qism Gemini\'ga yuboriladi, to\'plamlar tayyor bo\'ladi; kunlarga tartib bilan joylanadi (imtihon kunlari o\'tkaziladi)', async () => {
  const r = await post(planBody());
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.total_sets, 5);
  await waitPlan(r.data.id);

  const g = await t.call('GET', `/api/admin/book-plans/${r.data.id}`, { token: admin });
  assert.equal(g.data.plan.ready, 5);
  assert.deepEqual(g.data.sets.map((s) => [s.pages.from, s.pages.to]), [[3, 5], [6, 7], [8, 9], [10, 12], [13, 14]]);
  assert.equal(g.data.sets[0].title, 'Key Words Test · Section 1 (1/3)');
  assert.equal(gem.calls.uploads.length, 5);
  assert.ok(gem.calls.uploads.every((u) => u.mime === 'application/pdf'));

  const place = await t.call('POST', `/api/admin/book-plans/${r.data.id}/place`, { token: admin });
  assert.equal(place.status, 200);
  const expected = regularDaysOfLevel('pre-intermediate').slice(0, 5);
  assert.deepEqual(place.data.placed.map((p) => p.day), expected);
  assert.equal(expected[0], 141);
  assert.ok(!expected.includes(147), '147 = mini-imtihon kuni');
  assert.equal(place.data.overflow, 0);

  // Idempotent
  const again = await t.call('POST', `/api/admin/book-plans/${r.data.id}/place`, { token: admin });
  assert.deepEqual(again.data.placed.map((p) => p.day), expected);

  // Kurs xaritasi
  const map = await t.call('GET', '/api/admin/course-map', { token: admin });
  const lvl = map.data.levels.find((l) => l.level === 'pre-intermediate');
  assert.equal(lvl.from, 141);
  assert.equal(lvl.to, 294);
  assert.equal(lvl.regular_total, 132);
  assert.equal(lvl.regular_with_books, 5);
  assert.equal(lvl.days.find((d) => d.day === 147).type, 'mini_check');
  assert.equal(lvl.days.find((d) => d.day === 141).books.length, 1);
  assert.equal(lvl.days.find((d) => d.day === 141).has_plan, true);

  // O'quvchi 141-kunda kitob mashqlarini ko'radi
  const s = await t.makeStudent('Plan Kid');
  const User = require('../models/User');
  await User.updateOne({ _id: s.user.id }, { current_day: 141 });
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.status, 200);
  assert.equal(lesson.data.book_sections.length, 1);
  assert.ok(lesson.data.exercises.length > 0);

  // Ikkinchi reja shu darajada ketma-ket bo'sh kunlarga tushadi (birinchisi band)
  const r2 = await post(planBody({ title: 'Ikkinchi', sections: JSON.stringify([{ title: 'A', from_page: 3, to_page: 4, days: 2 }]) }));
  await waitPlan(r2.data.id);
  const p2 = await t.call('POST', `/api/admin/book-plans/${r2.data.id}/place`, { token: admin });
  assert.deepEqual(p2.data.placed.map((p) => p.day), regularDaysOfLevel('pre-intermediate').slice(5, 7));

  // Ro'yxat va o'chirish
  const list = await t.call('GET', '/api/admin/book-plans', { token: admin });
  assert.equal(list.data.plans.length, 2);
  assert.equal((await t.call('DELETE', `/api/admin/book-plans/${r2.data.id}`, { token: admin })).status, 200);
  assert.equal(await BookMaterial.countDocuments({ plan: r2.data.id }), 0);
});

test('bitta qism xato bo\'lsa: uning kuni bo\'sh qoladi (tartib buzilmaydi); qayta urinish asl PDF dan; qayta joylash o\'sha kunga qo\'yadi', async () => {
  await startGem({ responder: (body, n) => (n === 3 ? { status: 400, error: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } } } : { status: 200, json: require('./fakeGemini').goodBook() }) });
  const r = await post(planBody({ title: 'Xatoli', level: 'intermediate' }));
  await waitPlan(r.data.id);
  let g = await t.call('GET', `/api/admin/book-plans/${r.data.id}`, { token: admin });
  assert.equal(g.data.plan.ready, 4);
  assert.equal(g.data.plan.failed, 1);
  assert.equal(g.data.plan.can_retry, true);

  const free = regularDaysOfLevel('intermediate');
  const place = await t.call('POST', `/api/admin/book-plans/${r.data.id}/place`, { token: admin });
  const days = Object.fromEntries(place.data.placed.map((p, i) => [p.title, p.day]));
  assert.equal(place.data.placed.length, 4);
  assert.equal(place.data.waiting, 1);
  assert.ok(!place.data.placed.some((p) => p.day === free[2]), '3-qism kuni bo\'sh qolishi kerak');
  assert.equal(place.data.placed[2].day, free[3], '4-qism o\'z kuniga tushadi');

  // Qayta urinish (Gemini endi sog'lom)
  await startGem();
  const retry = await t.call('POST', `/api/admin/book-plans/${r.data.id}/retry`, { token: admin });
  assert.equal(retry.status, 202);
  await sleep(300);
  await queue.onIdle();
  g = await t.call('GET', `/api/admin/book-plans/${r.data.id}`, { token: admin });
  assert.equal(g.data.plan.ready, 5);
  const place2 = await t.call('POST', `/api/admin/book-plans/${r.data.id}/place`, { token: admin });
  assert.deepEqual(place2.data.placed.map((p) => p.day), free.slice(0, 5));
  assert.equal((await t.call('POST', `/api/admin/book-plans/${r.data.id}/retry`, { token: admin })).status, 409, 'xato qolmagan');
});

test('PDF dan sahifa yetmasa reja "failed" bo\'ladi va tushunarli xabar beradi', async () => {
  const r = await post(planBody({ title: 'Uzun', sections: JSON.stringify([{ title: 'Z', from_page: 20, to_page: 60, days: 4 }]) }));
  assert.equal(r.status, 202);
  await waitPlan(r.data.id);
  const g = await t.call('GET', `/api/admin/book-plans/${r.data.id}`, { token: admin });
  assert.equal(g.data.plan.status, 'failed');
  assert.match(g.data.plan.error_message, /sahifa/);
  assert.equal(gem.calls.uploads.length, 0);
});
