const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeState, summarize, weekKey } = require('../lib/courseMerge');

test('birlashtirish: progress orqaga ketmaydi, ikki qurilma qo\'shiladi', () => {
  const server = { u: 3, d: { 0: { c: 1, t: 90, s: { 0: 1 } }, 1: { s: { 0: 1 } } }, pts: { d0: { date: '2026-10-20', p: 10 } } };
  const phone = { u: 2, d: { 1: { c: 1, t: 80, s: { 1: 1 } }, 2: { s: {} } }, pts: { d1: { date: '2026-10-21', p: 7 }, d0: { date: '2026-10-20', p: 4 } } };
  const m = mergeState(server, phone);
  assert.equal(m.u, 3);
  assert.equal(m.d[0].c, 1);
  assert.equal(m.d[1].c, 1);
  assert.deepEqual(Object.keys(m.d[1].s).sort(), ['0', '1']);
  assert.equal(m.pts.d0.p, 10);
  assert.equal(m.pts.d1.p, 7);
});

test('serverda tugagan kun telefonda tugamagan bo\'lsa ham tugagan qoladi', () => {
  const m = mergeState({ d: { 5: { c: 1, t: 95 } } }, { d: { 5: { s: { 0: 1 } } } });
  assert.equal(m.d[5].c, 1);
  assert.equal(m.d[5].t, 95);
});

test('xulosa: kun, ball, haftalik ball, aniqlik', () => {
  const s = summarize({ u: 4, d: { 0: { c: 1, t: 80 }, 1: { c: 1, t: 100 }, 2: { s: {} } }, pts: { d0: { date: '2026-10-20', p: 10 }, d1: { date: '2026-10-27', p: 5 } } });
  assert.equal(s.course_day, 5);
  assert.equal(s.days_done, 2);
  assert.equal(s.points, 15);
  assert.equal(s.accuracy, 90);
  assert.deepEqual(s.week_points, { '2026-W43': 10, '2026-W44': 5 });
  assert.equal(s.last_study_date, '2026-10-27');
});

test('hafta kaliti', () => {
  assert.equal(weekKey('2026-10-24'), '2026-W43');
  assert.equal(weekKey('bad'), null);
});

test('bo\'sh/yaroqsiz kirishlar xato bermaydi', () => {
  assert.deepEqual(summarize(null).days_done, 0);
  assert.equal(mergeState(null, { u: 1 }).u, 1);
});

test('kun -> daraja (450 kunlik kurs)', () => {
  const { levelForCourseDay } = require('../lib/courseMerge');
  const assert = require('node:assert/strict');
  assert.equal(levelForCourseDay(1), 'beginner');
  assert.equal(levelForCourseDay(90), 'beginner');
  assert.equal(levelForCourseDay(91), 'elementary');
  assert.equal(levelForCourseDay(175), 'pre-intermediate');
  assert.equal(levelForCourseDay(265), 'intermediate');
  assert.equal(levelForCourseDay(373), 'upper-intermediate');
  assert.equal(levelForCourseDay(450), 'upper-intermediate');
});
