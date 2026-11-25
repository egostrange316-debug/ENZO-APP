const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAiChatHandler, DAILY_LIMIT } = require('../controllers/aiChatController');

function mockRes() {
  const out = { code: 0, body: null };
  return {
    out,
    status(c) {
      out.code = c;
      return { json(b) { out.body = b; return out; } };
    },
  };
}

test('aiChat: bo\'sh xabar 400 qaytaradi', async () => {
  const fn = makeAiChatHandler({ env: {} });
  const r = mockRes();
  await fn({ body: { message: '   ' }, user: { _id: 'u_empty' } }, r);
  assert.equal(r.out.code, 400);
});

test('aiChat: Groq JSON javob + o\'zbekcha tuzatish ishlaydi', async () => {
  const fakeFetch = async (url) => {
    assert.ok(url.includes('groq.com'));
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reply_en: 'Nice! What do you usually do on weekends?',
              correction_en: 'I agree with you.',
              correction_uz: 'Agree fe’l bo‘lgani uchun am qo‘yilmaydi.',
            }),
          },
        }],
      }),
    };
  };
  const fn = makeAiChatHandler({ env: { GROQ_API_KEY: 'test-key' }, fetchFn: fakeFetch });
  const r = mockRes();
  await fn({ body: { message: 'I am agree with you', level: 'B1', role: 'ielts' }, user: { _id: 'u_groq' } }, r);
  assert.equal(r.out.code, 200);
  assert.equal(r.out.body.provider, 'groq');
  assert.equal(r.out.body.correction_en, 'I agree with you.');
  assert.equal(r.out.body.remaining_today, DAILY_LIMIT - 1);
});

test('aiChat: Groq ishlamasa Gemini ga o\'tadi', async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (url.includes('groq.com')) return { ok: false, status: 429 };
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ reply_en: 'Great! Where would you like to travel?', correction_en: '', correction_uz: '' }) }],
          },
        }],
      }),
    };
  };
  const fn = makeAiChatHandler({ env: { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' }, fetchFn: fakeFetch });
  const r = mockRes();
  await fn({ body: { message: 'I love travelling', level: 'A1-A2', role: 'travel' }, user: { _id: 'u_gem' } }, r);
  assert.equal(calls, 2);
  assert.equal(r.out.code, 200);
  assert.equal(r.out.body.provider, 'gemini');
});

test('aiChat: kunlik 30 ta limitdan oshsa 429 qaytaradi', async () => {
  const fn = makeAiChatHandler({ env: {} });
  for (let i = 0; i < DAILY_LIMIT; i++) {
    const r = mockRes();
    await fn({ body: { message: 'Hello ' + i }, user: { _id: 'u_lim' } }, r);
    assert.equal(r.out.code, 200);
  }
  const rOver = mockRes();
  await fn({ body: { message: 'One more' }, user: { _id: 'u_lim' } }, rOver);
  assert.equal(rOver.out.code, 429);
});
