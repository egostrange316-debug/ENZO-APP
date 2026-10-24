const { test } = require('node:test');
const assert = require('node:assert/strict');
const { levelForDay, deriveLessonType } = require('../config/curriculum');
const { validateAndClean } = require('../services/geminiService');
const { planMigration, mapStudent } = require('../scripts/lib/transform');

test('curriculum: imtihon kunlari va darajalar', () => {
  assert.equal(deriveLessonType(1), 'regular');
  assert.equal(deriveLessonType(6), 'regular');
  assert.equal(deriveLessonType(7), 'mini_check');
  assert.equal(deriveLessonType(21), 'mini_check');
  assert.equal(deriveLessonType(28), 'mid_check');
  assert.equal(deriveLessonType(56), 'mid_check');
  assert.equal(deriveLessonType(70), 'final_exam');
  assert.equal(deriveLessonType(140), 'final_exam');
  assert.equal(deriveLessonType(294), 'final_exam');
  assert.equal(deriveLessonType(464), 'final_exam');
  assert.equal(deriveLessonType(646), 'final_exam');
  assert.equal(levelForDay(1), 'beginner');
  assert.equal(levelForDay(70), 'beginner');
  assert.equal(levelForDay(71), 'elementary');
  assert.equal(levelForDay(140), 'elementary');
  assert.equal(levelForDay(141), 'pre-intermediate');
  assert.equal(levelForDay(294), 'pre-intermediate');
  assert.equal(levelForDay(295), 'intermediate');
  assert.equal(levelForDay(464), 'intermediate');
  assert.equal(levelForDay(465), 'upper-intermediate');
  assert.equal(levelForDay(646), 'upper-intermediate');
});

const goodAi = () => ({
  unit_title: 'Family',
  vocabulary: [1, 2, 3].map((i) => ({ word: `w${i}`, translation_uz: `t${i}`, example_sentence: 'x' })),
  quizzes: [1, 2, 3].map((i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd'], correct_answer_index: 1 })),
  fill_in_the_blanks: [1, 2, 3].map((i) => ({ sentence_with_blank: `I ___ ${i}`, correct_word: 'w' })),
  speaking_questions: [{ topic: 't', question_text: 'q', hint_words: ['a'] }],
});

test('AI javobi tekshiruvi: yaxshisi o\'tadi, noto\'g\'ri indeks/bo\'sh joysiz mashq tashlab yuboriladi', () => {
  assert.equal(validateAndClean(goodAi(), 'regular').speaking_questions.length, 0);
  assert.equal(validateAndClean(goodAi(), 'final_exam').speaking_questions.length, 1);

  const badIdx = goodAi(); badIdx.quizzes[0].correct_answer_index = 7;
  assert.throws(() => validateAndClean(badIdx, 'regular'), /testlar/);   // 3 tadan 1 tasi yaroqsiz -> 2 < 3

  const noBlank = goodAi(); noBlank.fill_in_the_blanks[0].sentence_with_blank = 'no blank here';
  assert.throws(() => validateAndClean(noBlank, 'regular'), /bo'sh joy/);

  const noSpeak = goodAi(); noSpeak.speaking_questions = [];
  assert.throws(() => validateAndClean(noSpeak, 'final_exam'), /Speaking/);
  assert.throws(() => validateAndClean(null, 'regular'));
});

const rng = () => 0.5;
const files = [
  { id: 'f1', group_name: '1-guruh', title: 'Unit 1', created_at: '2026-01-01' },
  { id: 'f2', group_name: '1-guruh', title: 'Unit 2', created_at: '2026-01-02' },
  { id: 'f3', group_name: '2-guruh', title: 'Intermediate 1', created_at: '2026-01-03' },
  { id: 'f4', group_name: '1-guruh', title: 'Bo\'sh fayl', created_at: '2026-01-04' },
  { id: 'f5', group_name: 'Noma\'lum', title: 'Boshqa', created_at: '2026-01-05' },
];
const words = (fid, n) => Array.from({ length: n }, (_, i) => ({ id: `${fid}w${i}`, file_id: fid, uz_word: `uz${i}`, en_word: `en${i}`, lat_word: `l${i}` }));
const vocab = [...words('f1', 5), ...words('f2', 2), ...words('f3', 4), ...words('f5', 2)];
const ai = [{ file_id: 'f1', word_id: 'f1w0', sentence: 'I eat an ___ daily.', options: ['en0', 'a', 'b', 'c'], answer: 'en0' }];

test('migratsiya rejasi: kunlar ketma-ket, final kunlar band qilinmaydi, noma\'lum guruh va bo\'sh fayl o\'tkaziladi', () => {
  const r = planMigration({ files, vocab, aiExercises: ai, existingPlans: [], rng });
  assert.deepEqual(r.plans.map((p) => [p.legacy_file_id, p.day_number]), [['f1', 71], ['f2', 72], ['f3', 141]]);
  assert.equal(r.plans[0].lesson_type, 'regular');
  assert.equal(r.plans.find((p) => p.day_number === 141).level, 'pre-intermediate');
  assert.equal(r.skipped.length, 2);
  assert.deepEqual(r.finalPlaceholders.map((p) => p.day_number), [140, 294]);
  assert.ok(r.finalPlaceholders.every((p) => p.needs_content && p.lesson_type === 'final_exam'));
  // mazmun: AI mashqidan misol gap va bo'sh joy mashqi
  assert.equal(r.plans[0].vocabulary[0].example_sentence, 'I eat an en0 daily.');
  assert.equal(r.plans[0].fill_in_the_blanks.length, 1);
  // test: to'g'ri indeks to'g'ri so'zni ko'rsatadi
  for (const q of r.plans[0].quizzes) {
    const w = vocab.find((v) => v.file_id === 'f1' && v.uz_word === q.question);
    assert.equal(q.options[q.correct_answer_index], w.en_word);
  }
});

test('migratsiya qayta ishga tushirilsa dublikat yaratmaydi va band kunlarni bosmaydi', () => {
  const first = planMigration({ files, vocab, aiExercises: ai, existingPlans: [], rng });
  const existing = [...first.plans, ...first.finalPlaceholders].map((p) => ({ day_number: p.day_number, legacy_file_id: p.legacy_file_id }));
  const again = planMigration({ files, vocab, aiExercises: ai, existingPlans: existing, rng });
  assert.equal(again.plans.length, 0);
  assert.equal(again.finalPlaceholders.length, 0);

  // 71-kunni AI parser bilan qo'lda kiritilgan reja band qilgan bo'lsa, birinchi fayl 72-kunga tushadi
  const manual = planMigration({ files, vocab, aiExercises: ai, existingPlans: [{ day_number: 71 }], rng });
  assert.deepEqual(manual.plans.slice(0, 2).map((p) => p.day_number), [72, 73]);
});

test('o\'quvchi xaritasi: bloklangan holat va muddat', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  const u = mapStudent({ id: 'uuid-1', full_name: ' Ali ', group_name: '2-guruh', ball: 40, words_count: 9, blocked: true }, { subDays: 30, now });
  assert.equal(u.full_name, 'Ali');
  assert.equal(u.status, 'blocked');
  assert.equal(u.legacy_id, 'uuid-1');
  assert.equal(u.subscription_end_date.toISOString(), '2026-11-07T00:00:00.000Z');
  assert.equal(u.current_day, 1);
});

test('obuna sanalari: oy oxiri (Toshkent), kabisa fevral, dekabr o\'tishi, grace holatlari', () => {
  const sub = require('../lib/subscription');
  // 8-oktyabr -> 31-oktyabr 23:59:59.999 Toshkent = 18:59:59.999Z
  assert.equal(sub.endOfMonth(new Date('2026-10-08T10:00:00Z')).toISOString(), '2026-10-31T18:59:59.999Z');
  assert.equal(sub.endOfMonth(new Date('2026-10-08T10:00:00Z'), 1).toISOString(), '2026-11-30T18:59:59.999Z');
  assert.equal(sub.endOfMonth(new Date('2028-02-10T10:00:00Z')).toISOString(), '2028-02-29T18:59:59.999Z'); // kabisa yil
  assert.equal(sub.endOfMonth(new Date('2026-12-15T10:00:00Z'), 1).toISOString(), '2027-01-31T18:59:59.999Z');
  // UTC bo'yicha 30-oktyabr 20:00 = Toshkentda 31-oktyabr 01:00 -> hali oktyabr
  assert.equal(sub.endOfMonth(new Date('2026-10-30T20:00:00Z')).toISOString(), '2026-10-31T18:59:59.999Z');
  // UTC bo'yicha 31-oktyabr 19:30 = Toshkentda 1-noyabr 00:30 -> noyabr
  assert.equal(sub.endOfMonth(new Date('2026-10-31T19:30:00Z')).toISOString(), '2026-11-30T18:59:59.999Z');

  assert.equal(sub.endOfLocalDay('2026-02-31'), null);
  assert.equal(sub.endOfLocalDay('abc'), null);
  assert.equal(sub.endOfLocalDay('2026-03-10').toISOString(), '2026-03-10T18:59:59.999Z');

  const end = new Date('2026-10-31T18:59:59.999Z');
  const at = (iso, extra = {}) => sub.subscriptionInfo({ subscription_end_date: end, status: 'active', ...extra }, new Date(iso));
  assert.equal(at('2026-10-20T00:00:00Z').state, 'paid');
  assert.equal(at('2026-10-20T00:00:00Z').days_left, 12);
  assert.equal(at('2026-11-01T00:00:00Z').state, 'grace');
  assert.equal(at('2026-11-05T18:00:00Z').state, 'grace');   // 5-noyabr kuni hali grace
  assert.equal(at('2026-11-05T19:30:00Z').state, 'blocked');  // 5 kun tugadi
  assert.equal(at('2026-10-20T00:00:00Z', { status: 'blocked' }).state, 'blocked');
});
