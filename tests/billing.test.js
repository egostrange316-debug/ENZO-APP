const test = require('node:test');
const assert = require('node:assert');
const { cycleEnd, newEndForPayment, clampPayDay, nextDueDate } = require('../lib/subscription');

// Toshkent = UTC+5. 2026-11-30 23:59:59.999 Toshkent = 2026-11-30T18:59:59.999Z
const tk = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h - 5, mi));

test('clampPayDay: noto\'g\'ri qiymat = 1', () => {
  assert.equal(clampPayDay(undefined), 1);
  assert.equal(clampPayDay(0), 1);
  assert.equal(clampPayDay(31), 1);
  assert.equal(clampPayDay('5'), 5);
  assert.equal(clampPayDay(28), 28);
});

test('pay_day=1: taqvim oyi oxiri (eski qoida bilan bir xil)', () => {
  const e = cycleEnd(1, tk(2026, 11, 12));
  assert.equal(e.getTime(), tk(2026, 12, 1).getTime() - 1);
});

test('pay_day=5: 12-noyabrda to\'lagan -> 4-dekabr oxirigacha', () => {
  const e = cycleEnd(5, tk(2026, 11, 12));
  assert.equal(e.getTime(), tk(2026, 12, 5).getTime() - 1);
});

test('pay_day=5: 3-noyabrda (to\'lov kunidan oldin) -> 4-noyabr oxirigacha', () => {
  const e = cycleEnd(5, tk(2026, 11, 3));
  assert.equal(e.getTime(), tk(2026, 11, 5).getTime() - 1);
});

test('yil o\'tishi: dekabr -> yanvar', () => {
  const e = cycleEnd(10, tk(2026, 12, 20));
  assert.equal(e.getTime(), tk(2027, 1, 10).getTime() - 1);
});

test('faol obuna: bitta davr qo\'shiladi (muddatdan keyingi davr)', () => {
  const now = tk(2026, 11, 20);
  const cur = tk(2026, 12, 5).getTime() - 1; // 4-dekabr oxirigacha to'langan
  const e = newEndForPayment(new Date(cur), 5, now, now);
  assert.equal(e.getTime(), tk(2027, 1, 5).getTime() - 1);
});

test('muddati tugagan: to\'lov sanasidagi davr', () => {
  const now = tk(2026, 11, 12);
  const cur = tk(2026, 11, 5).getTime() - 1;
  const e = newEndForPayment(new Date(cur), 5, now, now);
  assert.equal(e.getTime(), tk(2026, 12, 5).getTime() - 1);
});

test('eski o\'quvchi (pay_day=1, oy oxirigacha to\'langan) -> keyingi oy oxiri', () => {
  const now = tk(2026, 11, 20);
  const cur = tk(2026, 12, 1).getTime() - 1;
  const e = newEndForPayment(new Date(cur), undefined, now, now);
  assert.equal(e.getTime(), tk(2027, 1, 1).getTime() - 1);
});

test('keyingi to\'lov sanasi = muddatdan keyingi kun boshi', () => {
  const end = tk(2026, 12, 5).getTime() - 1;
  assert.equal(nextDueDate(new Date(end)).getTime(), tk(2026, 12, 5).getTime());
});
