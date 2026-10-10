const PronunciationAttempt = require('../models/PronunciationAttempt');
const svc = require('../services/pronunciationService');

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** POST /api/student/pronunciation  { word, uz?, day_number?, audio_base64, mime_type } */
const assessPronunciation = async (req, res) => {
  try {
    const word = clean(req.body?.word, 80);
    if (!word || !/[a-z]/i.test(word)) return res.status(400).json({ message: "So'z noto'g'ri" });
    const err = svc.validateAudio(req.body?.audio_base64, req.body?.mime_type);
    if (err) return res.status(400).json({ message: err });
    const r = await svc.assess({ word, uz: clean(req.body?.uz, 80), audioBase64: req.body.audio_base64, mimeType: req.body.mime_type });
    await PronunciationAttempt.create({
      user: req.user._id, word, day_number: Number.isInteger(req.body?.day_number) ? req.body.day_number : undefined,
      score: r.score, heard: r.heard, ai_score: r.ai_score, text_score: r.text_score, feedback_uz: r.feedback_uz, tip_uz: r.tip_uz,
    });
    const best = await PronunciationAttempt.findOne({ user: req.user._id, word }).sort({ score: -1 }).select('score').lean();
    res.status(200).json({ score: r.score, transcript: r.heard, feedback: r.feedback_uz, tip: r.tip_uz, best_score: best?.score ?? r.score });
  } catch (e) {
    console.error('assessPronunciation xatosi:', e.message);
    const status = e.status === 503 ? 503 : 502;
    res.status(status).json({ message: status === 503 ? 'Talaffuz xizmati sozlanmagan. Ustozga ayting.' : "Talaffuzni tekshirib bo'lmadi. Birozdan keyin qayta urinib ko'ring." });
  }
};

/** GET /api/student/pronunciation/history?word=apple (o'z tarixi) */
const myHistory = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.word) filter.word = clean(req.query.word, 80);
    const rows = await PronunciationAttempt.find(filter).sort({ createdAt: -1 }).limit(30).select('word score heard feedback_uz createdAt').lean();
    res.status(200).json({ attempts: rows });
  } catch (e) { res.status(500).json({ message: 'Server xatosi' }); }
};

module.exports = { assessPronunciation, myHistory };
