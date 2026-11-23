// Controller testi: Mongo kerak emas — findStudent va User soxta qilinadi.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const mkRes = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const tk = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h - 5));

function load(student) {
  const User = { findById: async () => student, findOne: async () => student };
  const orig = Module._load;
  Module._load = function (req, ...a) {
    if (/models\/User$/.test(req)) return User;
    return orig.call(this, req, ...a);
  };
  delete require.cache[require.resolve('../controllers/adminController')];
  const c = require('../controllers/adminController');
  Module._load = orig;
  return c;
}
const mkStudent = (o = {}) => ({
  _id: 'a'.repeat(24), full_name: 'Test', status: 'active', role: 'student',
  subscription_end_date: tk(2026, 12, 1), payments: [], pay_day: 5,
  save: async function () {}, markModified() {}, ...o,
});

test('to\'ladi: bitta davr qo\'shadi va yozuv qoldiradi', async () => {
  const s = mkStudent({ subscription_end_date: new Date(Date.now() - 86400000) });
  const c = load(s);
  const res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: { amount: '300 000' }, user: { _id: 'x' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(s.payments.length, 1);
  assert.equal(s.payments[0].amount, 300000);
  assert.equal(s.monthly_fee, 300000);
  assert.ok(s.subscription_end_date > new Date());
});

test('qo\'sh bosish rad etiladi (409)', async () => {
  const s = mkStudent({ subscription_end_date: new Date(Date.now() - 86400000) });
  const c = load(s);
  const body = { amount: 100 };
  await c.recordCyclePayment({ params: { id: s._id }, body, user: { _id: 'x' } }, mkRes());
  const res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body, user: { _id: 'x' } }, res);
  assert.equal(res.code, 409);
  assert.equal(s.payments.length, 1);
});

test('bekor qilish: muddat va holat qaytadi', async () => {
  const before = new Date(Date.now() - 86400000);
  const s = mkStudent({ subscription_end_date: before, status: 'blocked' });
  const c = load(s);
  await c.recordCyclePayment({ params: { id: s._id }, body: {}, user: { _id: 'x' } }, mkRes());
  assert.equal(s.status, 'active');
  const res = mkRes();
  await c.cancelLastPayment({ params: { id: s._id }, body: {}, user: { _id: 'x' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(s.subscription_end_date.getTime(), before.getTime());
  assert.equal(s.status, 'blocked');
  assert.equal(s.payments[0].cancelled, true);
});

test('kelajak sanasi va noto\'g\'ri summa rad etiladi', async () => {
  const s = mkStudent({ subscription_end_date: new Date(Date.now() - 86400000) });
  const c = load(s);
  let res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: { paid_on: '2099-01-01' }, user: { _id: 'x' } }, res);
  assert.equal(res.code, 400);
  res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: { amount: 'abc' }, user: { _id: 'x' } }, res);
  assert.equal(res.code, 400);
  assert.equal(s.payments.length, 0);
});

test('setBilling: 1..28 tekshiriladi', async () => {
  const s = mkStudent();
  const c = load(s);
  let res = mkRes();
  await c.setBilling({ params: { id: s._id }, body: { pay_day: 31 } }, res);
  assert.equal(res.code, 400);
  res = mkRes();
  await c.setBilling({ params: { id: s._id }, body: { pay_day: 12, monthly_fee: '250 000' } }, res);
  assert.equal(res.code, 200);
  assert.equal(s.pay_day, 12);
  assert.equal(s.monthly_fee, 250000);
});

test('yangi o\'quvchi (faqat 30 kunlik sinov): birinchi to\'lov to\'lov sanasidan hisoblanadi', async () => {
  const created = new Date(Date.now() - 2 * 86400000);
  const s = mkStudent({ createdAt: created, subscription_end_date: new Date(created.getTime() + 30 * 86400000), pay_day: 5 });
  const c = load(s);
  const res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: { amount: '300000' }, user: { _id: 'x' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  // keyingi 5-sanagacha (sinov oxiridan keyingi davrga emas): ~40 kundan oshmasligi kerak
  assert.ok(s.subscription_end_date.getTime() - Date.now() <= 36 * 86400000, String(s.subscription_end_date));
});

test('eski o\'quvchi (uzoq muddat, to\'lov yozuvi yo\'q): muddat saqlanadi, keyingi davr qo\'shiladi', async () => {
  const created = new Date(Date.now() - 200 * 86400000);
  const end = new Date(Date.now() + 20 * 86400000);
  const s = mkStudent({ createdAt: created, subscription_end_date: end, pay_day: 5 });
  const c = load(s);
  const res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: {}, user: { _id: 'x' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(s.subscription_end_date > end);
});

test('yangi o\'quvchi, to\'lov kuni belgilanmagan: birinchi to\'lov kuni oylik to\'lov kuniga aylanadi (~1 oy)', async () => {
  const created = new Date(Date.now() - 1 * 86400000);
  const s = mkStudent({ createdAt: created, subscription_end_date: new Date(created.getTime() + 30 * 86400000), pay_day: undefined });
  const c = load(s);
  const res = mkRes();
  await c.recordCyclePayment({ params: { id: s._id }, body: { amount: '300000' }, user: { _id: 'x' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(s.pay_day >= 1 && s.pay_day <= 28);
  const days = (s.subscription_end_date.getTime() - Date.now()) / 86400000;
  assert.ok(days > 26 && days < 32, String(days));
});
