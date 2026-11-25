/**
 * Xavfsiz AI Free Conversation endpoint (POST /api/student/ai-chat).
 * API kalitlar faqat serverda turadi (APK ichida emas). Kuniga 30 ta bepul xabar/o'quvchi.
 * Kaskad: Groq (Llama 3.3 70B) -> Gemini Flash -> Graceful fallback.
 */
const { tashkentNow } = require('../lib/dayStatus');

const DAILY_LIMIT = 30;
const usageMap = new Map(); // key: `${userId}:${YYYY-MM-DD}` -> count

const ROLE_PROMPTS = {
  friend: 'a warm, encouraging native English friend chatting casually about daily life, hobbies, and goals',
  ielts: 'a supportive IELTS Speaking examiner asking Part 1/2 follow-up questions and nudging toward Band 7.5–8.0 vocabulary',
  interview: 'a polite international HR interviewer conducting a friendly English job interview',
  travel: 'a helpful airport/hotel/cafe staff member practicing practical real-world travel English',
};

const LEVEL_HINTS = {
  'A1-A2': 'Use very simple, clear A1–A2 English sentences (max 2 short sentences + 1 easy question).',
  B1: 'Use natural, everyday B1 English (2–3 sentences + 1 engaging follow-up question).',
  'B2-C1': 'Use rich, natural B2–C1 / IELTS Band 8.0 English idioms and collocations (2–3 sentences + 1 thoughtful question).',
};

function checkAndIncrementUsage(userId, dateStr) {
  const key = `${userId}:${dateStr}`;
  const cur = usageMap.get(key) || 0;
  if (cur >= DAILY_LIMIT) return { allowed: false, remaining: 0 };
  usageMap.set(key, cur + 1);
  if (usageMap.size > 5000) {
    for (const k of usageMap.keys()) {
      if (!k.endsWith(`:${dateStr}`)) usageMap.delete(k);
    }
  }
  return { allowed: true, remaining: DAILY_LIMIT - (cur + 1) };
}

function buildSystemPrompt(level, role) {
  const roleDesc = ROLE_PROMPTS[role] || ROLE_PROMPTS.friend;
  const lvlHint = LEVEL_HINTS[level] || LEVEL_HINTS.B1;
  return (
    `You are Husanboy Teacher's AI English Speaking Coach acting as ${roleDesc} for an Uzbek student.\n` +
    `${lvlHint}\n` +
    `Respond ONLY with valid JSON in this exact format:\n` +
    `{"reply_en":"Your natural English reply + 1 follow-up question","correction_en":"Corrected version of the student's message if they made a grammar/word mistake, or empty string if already natural","correction_uz":"Short 1-sentence Uzbek explanation of the correction (Latin Uzbek only), or empty string if no mistake"}\n` +
    `Rules: Never use Cyrillic or Turkish characters. Keep reply_en under 280 chars. Be warm and motivating.`
  );
}

function parseJsonSafe(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj && typeof obj.reply_en === 'string' && obj.reply_en.trim()) {
      return {
        reply_en: obj.reply_en.trim().slice(0, 400),
        correction_en: String(obj.correction_en || '').trim().slice(0, 220),
        correction_uz: String(obj.correction_uz || '').trim().slice(0, 220),
      };
    }
  } catch (_) {}
  return null;
}

async function callGroq({ system, messages, apiKey, fetchFn }) {
  const r = await fetchFn('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 320,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);
  const data = await r.json();
  return parseJsonSafe(data?.choices?.[0]?.message?.content);
}

async function callGemini({ system, messages, apiKey, fetchFn }) {
  const conv = messages.map((m) => `${m.role === 'assistant' ? 'Coach' : 'Student'}: ${m.content}`).join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\nConversation:\n${conv}\n\nRespond ONLY with JSON:` }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 320, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const data = await r.json();
  return parseJsonSafe(data?.candidates?.[0]?.content?.parts?.[0]?.text);
}

function makeAiChatHandler({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  return async function aiChat(req, res) {
    try {
      const msg = String(req.body?.message || '').trim();
      if (!msg || msg.length > 500) {
        return res.status(400).json({ message: "Xabar 1–500 belgi oralig'ida bo'lishi kerak" });
      }
      const level = LEVEL_HINTS[req.body?.level] ? req.body.level : 'B1';
      const role = ROLE_PROMPTS[req.body?.role] ? req.body.role : 'friend';
      const dateStr = tashkentNow().date;
      const uid = String(req.user?._id || req.user?.id || 'anon');
      const lim = checkAndIncrementUsage(uid, dateStr);
      if (!lim.allowed) {
        return res.status(429).json({
          message: `Bugungi ${DAILY_LIMIT} ta bepul AI suhbat limiti tugadi. Ertaga yana davom etamiz yoki oflayn sahnalarda mashq qiling!`,
          remaining_today: 0,
        });
      }

      const rawHist = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
      const messages = rawHist
        .filter((h) => h && typeof h.text === 'string' && h.text.trim())
        .map((h) => ({ role: h.from === 'ai' ? 'assistant' : 'user', content: h.text.trim().slice(0, 300) }));
      messages.push({ role: 'user', content: msg });

      const system = buildSystemPrompt(level, role);
      let out = null;
      let provider = 'fallback';

      if (env.GROQ_API_KEY) {
        try {
          out = await callGroq({ system, messages, apiKey: env.GROQ_API_KEY, fetchFn });
          if (out) provider = 'groq';
        } catch (_) {}
      }
      if (!out && env.GEMINI_API_KEY) {
        try {
          out = await callGemini({ system, messages, apiKey: env.GEMINI_API_KEY, fetchFn });
          if (out) provider = 'gemini';
        } catch (_) {}
      }
      if (!out) {
        out = {
          reply_en: "That's a great point! Could you tell me a little more about that in English?",
          correction_en: '',
          correction_uz: '',
        };
      }

      return res.status(200).json({
        ...out,
        remaining_today: lim.remaining,
        provider,
      });
    } catch (e) {
      console.error('aiChat xatosi:', e.message);
      return res.status(500).json({ message: 'AI suhbatda vaqtincha xato' });
    }
  };
}

exports.aiChat = makeAiChatHandler();
exports.makeAiChatHandler = makeAiChatHandler;
exports.DAILY_LIMIT = DAILY_LIMIT;
