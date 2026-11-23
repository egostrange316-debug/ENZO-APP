const test = require('node:test');
const assert = require('node:assert');
const { mergeKids, kidsSummary } = require('../lib/kidsMerge');

test('tugatilgan kun yo\'qolmaydi (ikki tomondan)', () => {
  const a = { prog: { 1: { done: true }, 3: { done: false } }, ts: 5 };
  const b = { prog: { 2: { done: true }, 3: { done: true } }, ts: 9 };
  const r = mergeKids(a, b);
  assert.ok(r.prog[1].done && r.prog[2].done && r.prog[3].done);
});
test('yulduz max, log max, yangi ts dan srs/err', () => {
  const a = { stars: 10, log: { 100: 1 }, srs: { x: 1 }, ts: 1, last: 5, streak: 2 };
  const b = { stars: 7, log: { 100: 2, 101: 1 }, srs: { y: 1 }, ts: 2, last: 4, streak: 9 };
  const r = mergeKids(a, b);
  assert.equal(r.stars, 10); assert.deepEqual(r.log, { 100: 2, 101: 1 });
  assert.deepEqual(r.srs, { y: 1 }); assert.equal(r.streak, 2); assert.equal(r.ts, 2);
});
test('bo\'sh / buzuq kirish', () => {
  const r = mergeKids(null, 'x');
  assert.deepEqual(r.prog, {}); assert.equal(r.stars, 0);
});
test('summary: boshlanish kunidan hisoblanadi', () => {
  const s = { prog: { 1: { done: true }, 2: { done: true }, 21: { done: true } } };
  assert.deepEqual(kidsSummary(s, 1), { done: 3, day: 3 });
  assert.deepEqual(kidsSummary(s, 21), { done: 3, day: 22 });
});
