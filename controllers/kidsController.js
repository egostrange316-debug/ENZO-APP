/**
 * Kids 200 kun (o'quvchi):
 *  GET /api/student/kids        -> { state, start }
 *  PUT /api/student/kids {state} -> birlashtiradi, { state, start } qaytaradi (takror yuborish xavfsiz)
 */
const KidsState = require('../models/KidsState');
const { mergeKids, kidsSummary } = require('../lib/kidsMerge');
const MAX_BYTES = 400 * 1024;
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
const startOf = (u) => Math.min(200, Math.max(1, Number(u.kids_start) || 1));

const getKids = async (req, res) => {
  try {
    const d = await KidsState.findOne({ user: req.user._id }).lean();
    res.status(200).json({ state: d ? parse(d.data) : null, start: startOf(req.user) });
  } catch (e) { console.error('getKids xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};
const putKids = async (req, res) => {
  try {
    const b = req.body && req.body.state;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ message: "Ma'lumot noto'g'ri" });
    if (Buffer.byteLength(JSON.stringify(b)) > MAX_BYTES) return res.status(413).json({ message: "Ma'lumot juda katta" });
    const cur = await KidsState.findOne({ user: req.user._id }).lean();
    const merged = mergeKids(b, cur ? parse(cur.data) : {});
    const start = startOf(req.user);
    const sum = kidsSummary(merged, start);
    await KidsState.updateOne({ user: req.user._id }, { $set: { data: JSON.stringify(merged), done: sum.done, day: sum.day } }, { upsert: true });
    res.status(200).json({ state: merged, start });
  } catch (e) { console.error('putKids xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};
module.exports = { getKids, putKids };
