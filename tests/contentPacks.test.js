const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadUnits, buildSets } = require('../lib/bookSeed');
const { validateAndCleanBook } = require('../services/bookService');

const PACKS = { 'eviu-elementary': 60, 'kw-preintermediate': 132, 'kw-intermediate': 148, 'kw-upperintermediate': 156 };

for (const [pack, count] of Object.entries(PACKS)) {
  test(`kontent paketi ${pack}: ${count} ta kun, hammasi to'g'ri`, () => {
    const units = loadUnits(pack);
    assert.equal(units.length, count);
    const ids = units.map((u) => u.unit);
    assert.equal(new Set(ids).size, ids.length, 'unit/bet raqamlari noyob');
    const cyr = /[Ѐ-ӿ]/;
    for (const u of units) {
      assert.ok(!cyr.test(JSON.stringify(u)), `kirill harflari: ${u.unit}`);
      const [s] = buildSets(u, { pack });
      const clean = validateAndCleanBook(s);
      assert.equal(clean.writing.vocabulary.length, u.vocabulary.length, `${pack} ${u.unit} lug'at`);
      assert.equal(clean.writing.grammar[0].exercises.length, u.gapfill.length, `${pack} ${u.unit} gap`);
      for (const e of u.gapfill) {
        assert.ok(e.options.length >= 4 && e.options.length <= 5);
        assert.equal(new Set(e.options.map((o) => o.toLowerCase())).size, e.options.length);
        assert.ok(e.options.some((o) => o.toLowerCase() === e.correct_word.toLowerCase()), `${pack} ${u.unit} gap javobi variantda yo'q`);
      }
      for (const q of [...u.reading.questions, ...u.listening.questions]) {
        assert.equal(q.options.length, 4);
        assert.ok(q.correct_answer_index >= 0 && q.correct_answer_index < 4);
      }
      assert.ok(u.speaking.length >= 3);
    }
  });
}
