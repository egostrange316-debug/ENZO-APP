const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const BookMaterial = require('../models/BookMaterial');
const StudyPlan = require('../models/StudyPlan');
const User = require('../models/User');
const { loadUnits, buildSets, seedPack } = require('../lib/bookSeed');
const { regularDaysOfLevel } = require('../controllers/bookPlanController');
const { validateAndCleanBook } = require('../services/bookService');
const { itemsFromBook } = require('../services/exerciseService');

const PACK = 'eviu-elementary';
let t, admin;
before(async () => { t = await setup(); admin = await t.makeAdmin(); });
after(async () => { await t.teardown(); });

test('kontent: 60 ta unit, hammasi validatsiyadan o\'tadi, javoblar to\'g\'ri', () => {
  const units = loadUnits(PACK);
  assert.equal(units.length, 60);
  assert.deepEqual(units.map((u) => u.unit), Array.from({ length: 60 }, (_, i) => i + 1));
  for (const u of units) {
    const [s] = buildSets(u, { pack: PACK });
    const clean = validateAndCleanBook({ ...s, writing: s.writing, speaking: s.speaking });
    assert.equal(clean.writing.vocabulary.length, u.vocabulary.length, `unit ${u.unit} lug'at`);
    for (const e of u.gapfill) assert.ok(e.options.some((o) => o.toLowerCase() === e.correct_word.toLowerCase()), `unit ${u.unit} gap`);
    for (const q of [...u.reading.questions, ...u.listening.questions]) {
      assert.equal(q.options.length, 4); assert.ok(q.correct_answer_index >= 0 && q.correct_answer_index < 4);
    }
    assert.equal(u.listening.dictation_sentences.length, 4);
    assert.ok(u.speaking.length >= 3);
  }
});

test('split: ikki qism bo\'ladi, hech narsa yo\'qolmaydi', () => {
  const u = loadUnits(PACK)[9];
  const [a, b] = buildSets(u, { pack: PACK, split: true });
  assert.equal(a.writing.vocabulary.length + b.writing.vocabulary.length, u.vocabulary.length);
  assert.equal(a.writing.grammar[0].exercises.length + b.writing.grammar[0].exercises.length, u.gapfill.length);
  assert.equal(a.reading.questions.length, 4);
  assert.equal(b.listening.questions.length, 4);
});

test('seedPack: 60 to\'plam birinchi 60 ta bo\'sh oddiy kunga, qayta ishga tushirsa dublikat yo\'q', async () => {
  const u = await User.findOne({ role: 'admin' });
  const r1 = await seedPack({ pack: PACK, level: 'elementary', uploader: u._id });
  assert.equal(r1.sets, 60);
  assert.equal(r1.overflow, 0);
  const days = regularDaysOfLevel('elementary');
  const docs = await BookMaterial.find({ seed_key: /^eviu-elementary:/ }).sort({ plan_order: 1 });
  assert.equal(docs.length, 60);
  assert.deepEqual(docs.map((d) => d.assigned_day), days.slice(0, 60));
  assert.ok(docs.every((d) => d.status === 'ready'));
  assert.ok(await StudyPlan.exists({ day_number: days[0] }));
  // qayta
  const r2 = await seedPack({ pack: PACK, level: 'elementary', uploader: u._id });
  assert.equal(r2.sets, 60);
  assert.equal(await BookMaterial.countDocuments({ seed_key: /^eviu-elementary:/ }), 60);
  // split rejimiga o'tish eski to'plamlarni olib tashlaydi
  const r3 = await seedPack({ pack: PACK, level: 'elementary', uploader: u._id, split: true });
  assert.equal(r3.sets, 120);
  assert.equal(await BookMaterial.countDocuments({ seed_key: /^eviu-elementary:/ }), 120);
  assert.equal(r3.placed.length + r3.overflow, 120);
  await seedPack({ pack: PACK, level: 'elementary', uploader: u._id });
  assert.equal(await BookMaterial.countDocuments({ seed_key: /^eviu-elementary:/ }), 60);
});

test('mashq elementlari: har unit uchun kalitlar noyob va to\'g\'ri javob mavjud', async () => {
  const docs = await BookMaterial.find({ seed_key: /^eviu-elementary:/ }).limit(60).lean();
  for (const d of docs) {
    const items = itemsFromBook(d);
    assert.ok(items.length > 30, `${d.title} mashqlari`);
    const keys = items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const it of items) if (it.kind === 'mcq') assert.ok(it.correct_index >= 0 && it.correct_index < it.options.length);
  }
});
