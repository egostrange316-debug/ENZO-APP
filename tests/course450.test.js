const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/course450');

test('450 kunlik jadval: kunlar ketma-ket, darajalar A1–C1 oralig\'i to\'g\'ri', () => {
  assert.equal(C.TOTAL_DAYS, 450);
  C.DAYS.forEach((x, i) => assert.equal(x.d, i + 1));
  assert.deepEqual(C.LEVEL_RANGES, { A1: { from: 1, to: 90 }, A2: { from: 91, to: 174 }, B1: { from: 175, to: 264 }, B2: { from: 265, to: 372 }, C1: { from: 373, to: 450 } });
  assert.equal(C.levelForDay(1), 'A1');
  assert.equal(C.levelForDay(91), 'A2');
  assert.equal(C.levelForDay(450), 'C1');
  assert.equal(C.levelForDay(9999), 'C1');
});

test('daraja chegaralari courseMerge bilan mos', () => {
  const { levelForCourseDay } = require('../lib/courseMerge');
  for (let d = 1; d <= 450; d++) assert.equal(levelForCourseDay(d), C.LEVEL_ID[C.levelForDay(d)], `kun ${d}`);
});

test('describeDay: mavzu, kitob joyi, daraja imtihoni', () => {
  const i = C.describeDay(1);
  assert.equal(i.grammar, 'G01 · To be: am / is / are');
  assert.match(i.book_ref, /^Kitob: 12–14-bet/);
  assert.equal(C.describeDay(90).type, 'final_exam');
  assert.equal(C.describeDay(5).type, 'regular');
});

test('studentDay: yangi tizim course_day, eskilar current_day, tugagan -> null', () => {
  assert.equal(C.studentDay({ course_day: 91, current_day: 3 }), 91);
  assert.equal(C.studentDay({ course_day: 0, current_day: 3 }), 3);
  assert.equal(C.studentDay({ course_day: 0, current_day: 647 }), null);
  assert.equal(C.studentDay({}), 1);
});
