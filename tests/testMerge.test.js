const test = require('node:test');
const assert = require('node:assert');
const { mergeTests, summarizeTests } = require('../lib/testMerge');

test('natija orqaga ketmaydi: yuqori ball va o\'tgan holat saqlanadi', () => {
  const m = mergeTests({ res: { 'g:5': { best: 90, pass: true } } }, { res: { 'g:5': { best: 40, pass: false }, 'v:5:1': { best: 85, pass: true } } });
  assert.deepEqual(m.res['g:5'], { best: 90, pass: true });
  assert.deepEqual(m.res['v:5:1'], { best: 85, pass: true });
});
test('80% dan past "pass" qabul qilinmaydi, noto\'g\'ri kalit tashlanadi', () => {
  const m = mergeTests({}, { res: { 'g:3': { best: 70, pass: true }, 'xx': { best: 100, pass: true }, 'v:1:r': { best: 999, pass: true } } });
  assert.equal(m.res['g:3'].pass, false);
  assert.equal(m.res.xx, undefined);
  assert.equal(m.res['v:1:r'].best, 100);
});
test('xatolar daftari: mijozniki yoziladi (o\'chirilganlar qaytmaydi); berilmasa eskisi qoladi', () => {
  assert.deepEqual(mergeTests({ err: { 'g:a#1': { ok: 0 } } }, { err: {} }).err, {});
  assert.deepEqual(Object.keys(mergeTests({ err: { 'g:a#1': { ok: 0 } } }, {}).err), ['g:a#1']);
});
test('prep va done OR bilan birlashadi', () => {
  const m = mergeTests({ prep: { 1: true } }, { prep: { 2: true }, done: { 7: true, x: true } });
  assert.deepEqual(m.prep, { 1: true, 2: true }); assert.deepEqual(m.done, { 7: true });
});
test('xulosa', () => {
  assert.deepEqual(summarizeTests({ res: { 'g:5': { best: 90, pass: true }, 'v:6:1': { best: 85, pass: true }, 'v:7:1': { best: 50, pass: false } } }), { vocab_passed: 1, grammar_passed: 1, last_day: 6 });
  assert.deepEqual(summarizeTests(null), { vocab_passed: 0, grammar_passed: 0, last_day: 0 });
});
