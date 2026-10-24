const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const BookMaterial = require('../models/BookMaterial');
const StudyPlan = require('../models/StudyPlan');
const User = require('../models/User');
const { seedAll } = require('../scripts/seedAll');
const { TOTAL_DAYS, LEVELS, LEVEL_RANGES, deriveLessonType } = require('../config/curriculum');
const { itemsFromBook, itemsFromPlan } = require('../services/exerciseService');

let t;
before(async () => { t = await setup(); await t.makeAdmin(); });
after(async () => { await t.teardown(); });

test('seedAll: 646 kunning hammasi to\'lgan, har dars kunida kitob + grammatika bor, imtihonlar tayyor', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const r = await seedAll(admin._id, () => {});
  for (const l of r.levels) assert.equal(l.overflow, 0, `${l.level} sig'magan to'plam`);
  assert.equal(await StudyPlan.countDocuments(), TOTAL_DAYS);
  const books = await BookMaterial.find({ status: 'ready' }).lean();
  const byDay = new Map();
  for (const b of books) { assert.ok(!byDay.has(b.assigned_day), `kun ${b.assigned_day} ikki marta`); byDay.set(b.assigned_day, b); }
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const type = deriveLessonType(d);
    const plan = await StudyPlan.findOne({ day_number: d }).lean();
    assert.ok(plan, `${d}-kun rejasi yo'q`);
    assert.equal(plan.needs_content, false, `${d}-kun`);
    if (type === 'regular') {
      const b = byDay.get(d);
      assert.ok(b, `${d}-kun kitobi yo'q`);
      assert.ok(b.book_ref?.label, `${d}-kun kitob joyi`);
      const card = b.writing.grammar[0];
      assert.ok(card.explanation_uz && card.forms.length && card.exercises.length === 3, `${d}-kun grammatika kartasi`);
      const keys = itemsFromBook(b).map((i) => i.key);
      assert.equal(new Set(keys).size, keys.length);
    } else if (type === 'final_exam') {
      assert.equal(plan.speaking_questions.length, 8, `${d} final`);
      assert.ok(!byDay.has(d));
    } else {
      assert.ok(plan.quizzes.length >= 7 && plan.fill_in_the_blanks.length >= 3, `${d}-imtihon savollari`);
      for (const q of plan.quizzes) assert.ok(q.correct_answer_index >= 0 && q.options.length === 4);
      assert.equal(new Set(itemsFromPlan(plan).map((i) => i.key)).size, plan.quizzes.length + plan.fill_in_the_blanks.length);
    }
  }
  // Har daraja o'zining kitobidan
  assert.match(byDay.get(1).book_ref.label, /English Vocabulary in Use: Elementary, 1-unit \(1-qism\)/);
  assert.match(byDay.get(2).book_ref.label, /1-unit \(2-qism\)/);
  assert.match(byDay.get(71).book_ref.label, /31-unit \(1-qism\)/);
  assert.match(byDay.get(141).book_ref.label, /Pre-Intermediate, 10-bet/);
  // qayta ishga tushirish dublikat yaratmaydi
  await seedAll(admin._id, () => {});
  assert.equal(await BookMaterial.countDocuments(), books.length);
  assert.equal(await StudyPlan.countDocuments(), TOTAL_DAYS);
});
