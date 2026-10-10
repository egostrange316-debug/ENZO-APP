/**
 * Talaffuzni baholash — Gemini (audio qabul qiladi). Mashqlar uchun AI ishlatilmaydi, faqat shu joyda.
 *
 * Ball ikki manbadan olinadi (barqarorlik uchun):
 *   text_score — Gemini eshitgan matn maqsad so'zga qanchalik yaqin (Levenshtein, aniq hisob);
 *   ai_score   — Gemini'ning talaffuz bahosi (urg'u, tovushlar, aniqlik).
 * Yakuniy ball = 60% text_score + 40% ai_score. Gemini ishlamasa servis xato beradi (soxta ball YO'Q).
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_AUDIO_BYTES = 1_500_000; // ~1.5 MB: bitta so'z/qisqa gap uchun yetarli
const ALLOWED_MIME = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a|x-m4a)(;.*)?$/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Maqsad so'z/ibora eshitilgan matnda qanchalik bor (0-100). Ko'p so'zli iboralar uchun oynalar solishtiriladi. */
function textScore(target, heard) {
  const t = norm(target);
  const h = norm(heard);
  if (!t || !h) return 0;
  const tw = t.split(' ');
  const hw = h.split(' ');
  let best = 0;
  for (let i = 0; i + tw.length <= hw.length || i === 0; i++) {
    const win = hw.slice(i, i + tw.length).join(' ');
    const d = levenshtein(t, win);
    best = Math.max(best, Math.round(100 * (1 - d / Math.max(t.length, win.length, 1))));
    if (i + tw.length >= hw.length) break;
  }
  return Math.max(0, Math.min(100, best));
}

function getModel() {
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY sozlanmagan'), { status: 503 });
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel(
    { model: process.env.GEMINI_MODEL || DEFAULT_MODEL, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } },
    process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined
  );
}

const prompt = (word, uz) => `You are a kind English pronunciation coach for Uzbek-speaking children and teens.
The student was asked to say the English word or phrase: "${word}"${uz ? ` (Uzbek meaning: "${uz}")` : ''}.
Listen to the attached recording. Ignore background noise. Return ONLY JSON:
{"heard":"<exactly what you heard, in English letters; empty string if nothing intelligible>",
 "ai_score":<integer 0-100, how clear and correct the pronunciation of the target is; 0 if the target was not said>,
 "feedback_uz":"<1-2 short encouraging sentences IN UZBEK (Latin script) about this attempt>",
 "tip_uz":"<one concrete tip IN UZBEK (Latin script) on the sound or stress to fix; empty if pronunciation was good>"}
Be honest: do not give a high score if the target word was not clearly said.`;

const clampInt = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function validateAudio(base64, mime) {
  if (typeof base64 !== 'string' || base64.length < 200) return "Ovoz yozilmadi";
  if (!ALLOWED_MIME.test(String(mime || ''))) return "Audio formati qo'llab-quvvatlanmaydi";
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_AUDIO_BYTES) return 'Yozuv juda uzun. Faqat bitta so\'z yoki qisqa ibora ayting';
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return "Audio noto'g'ri formatda";
  return null;
}

async function assess({ word, uz, audioBase64, mimeType }) {
  const model = getModel();
  const result = await model.generateContent([
    { inlineData: { mimeType: String(mimeType).split(';')[0], data: audioBase64.replace(/\s/g, '') } },
    { text: prompt(word, uz) },
  ]);
  const raw = result.response.text().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Object.assign(new Error("Gemini javobini o'qib bo'lmadi"), { status: 502 }); }
  const heard = clean(parsed.heard, 200);
  const ts = textScore(word, heard);
  const ai = clampInt(parsed.ai_score);
  // Gemini nimadir eshitgan bo'lsa-yu, maqsad so'z umuman yo'q bo'lsa — yuqori ball berilmasin
  const score = heard ? clampInt(0.6 * ts + 0.4 * Math.min(ai, ts >= 40 ? 100 : 40)) : 0;
  return { score, heard, ai_score: ai, text_score: ts, feedback_uz: clean(parsed.feedback_uz, 400), tip_uz: clean(parsed.tip_uz, 300) };
}

module.exports = { assess, textScore, validateAudio, MAX_AUDIO_BYTES };
