const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { startFakeGemini } = require('./fakeGemini');
const PronunciationAttempt = require('../models/PronunciationAttempt');
const { textScore } = require('../services/pronunciationService');

let t, s, fake, mode = { heard: 'apple', ai_score: 90 };
const audio = Buffer.alloc(3000, 1).toString('base64');
const body = (extra = {}) => ({ word: 'apple', uz: 'olma', day_number: 1, audio_base64: audio, mime_type: 'audio/webm;codecs=opus', ...extra });

before(async () => {
  t = await setup();
  s = await t.makeStudent('Talaffuz Bola');
  fake = await startFakeGemini({
    responder: () => mode.fail ? { status: 500 } : mode.raw !== undefined ? { status: 200, raw: mode.raw }
      : { status: 200, json: { heard: mode.heard, ai_score: mode.ai_score, feedback_uz: 'Barakalla!', tip_uz: 'p tovushini aniq ayting' } },
  });
  process.env.GEMINI_BASE_URL = fake.url;
  process.env.GEMINI_API_KEY = 'test-key';
});
after(async () => { await fake.close(); await t.teardown(); });

test('textScore: aniq, yaqin va boshqa so\'z', () => {
  assert.equal(textScore('apple', 'apple'), 100);
  assert.equal(textScore('apple', 'I said Apple!'), 100);
  assert.ok(textScore('apple', 'appel') >= 50 && textScore('apple', 'appel') < 100);
  assert.ok(textScore('apple', 'banana') < 40);
  assert.equal(textScore('apple', ''), 0);
});

test('to\'g\'ri talaffuz -> yuqori ball, saqlanadi, best_score qaytadi', async () => {
  const r = await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() });
  assert.equal(r.status, 200);
  assert.equal(r.data.score, 96); // 0.6*100 + 0.4*90
  assert.equal(r.data.transcript, 'apple');
  assert.equal(r.data.feedback, 'Barakalla!');
  assert.equal(r.data.best_score, 96);
  assert.equal(fake.calls.generates.at(-1).model, process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const saved = await PronunciationAttempt.find({ word: 'apple' }).lean();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].score, 96);
});

test('boshqa so\'z eshitilsa ball past; best_score eng yuqorini saqlaydi', async () => {
  mode = { heard: 'banana', ai_score: 95 };
  const r = await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() });
  assert.equal(r.status, 200);
  assert.ok(r.data.score < 40);
  assert.equal(r.data.best_score, 96);
  const h = await t.call('GET', '/api/student/pronunciation/history?word=apple', { token: s.token });
  assert.equal(h.data.attempts.length, 2);
});

test('hech narsa eshitilmasa ball 0', async () => {
  mode = { heard: '', ai_score: 80 };
  const r = await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() });
  assert.equal(r.data.score, 0);
});

test('noto\'g\'ri audio / so\'z / hajm -> 400', async () => {
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body({ mime_type: 'video/mp4' }) })).status, 400);
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body({ word: '123' }) })).status, 400);
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body({ audio_base64: 'AAAA' }) })).status, 400);
  const big = Buffer.alloc(1_600_000, 1).toString('base64');
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body({ audio_base64: big }) })).status, 400);
});

test('Gemini xatosi -> 502, buzuq javob -> 502, kalit yo\'q -> 503; soxta ball saqlanmaydi', async () => {
  const before = await PronunciationAttempt.countDocuments();
  mode = { fail: true };
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() })).status, 502);
  mode = { raw: 'not json' };
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() })).status, 502);
  delete process.env.GEMINI_API_KEY;
  assert.equal((await t.call('POST', '/api/student/pronunciation', { token: s.token, body: body() })).status, 503);
  process.env.GEMINI_API_KEY = 'test-key';
  assert.equal(await PronunciationAttempt.countDocuments(), before);
});

test('tokensiz so\'rov rad etiladi', async () => {
  assert.equal((await t.call('POST', '/api/student/pronunciation', { body: body() })).status, 401);
});
