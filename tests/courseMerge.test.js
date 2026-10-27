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

test('mock natijalari (mk) ikki qurilmadan birlashadi, zaif mavzular hisoblanadi', () => {
  const { mergeState, mockSummary } = require('../lib/courseMerge');
  const assert = require('node:assert/strict');
  const a = { u: 1, mk: { seen: { q1: 1 }, st: { G01: { n: 4, ok: 1 } }, hist: [{ d: 1, k: 'topic', L: 'A1', p: 50, n: 10 }], exam: { A1: 80 }, ex: [] } };
  const b = { u: 2, mk: { seen: { q2: 1 }, st: { G01: { n: 5, ok: 2 }, G02: { n: 3, ok: 3 } }, hist: [{ d: 2, k: 'topic', L: 'A1', p: 90, n: 10 }, { d: 3, k: 'bank', L: 'A1', p: 10, n: 5 }], exam: { A1: 85 }, ex: [] }, bk: { 3: 1 }, ph: { x: 1 } };
  const m = mergeState(a, b);
  assert.deepEqual(Object.keys(m.mk.seen).sort(), ['q1', 'q2']);
  assert.equal(m.mk.st.G01.n, 5);
  assert.equal(m.mk.exam.A1, 85);
  assert.equal(m.mk.hist.length, 3);
  const s = mockSummary(m);
  assert.equal(s.attempts, 2);
  assert.equal(s.avg_last10, 70);
  assert.deepEqual(s.weak_topics.map((w) => [w.topic, w.percent]), [['G01', 40]]);
  assert.equal(s.book_ticks, 1);
  assert.equal(s.phrases_learned, 1);
  assert.equal(mockSummary({}).attempts, 0);
});
