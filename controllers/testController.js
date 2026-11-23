/**
 * Kun testi natijalari (o'quvchi):
 *  GET /api/student/day-tests          -> serverdagi natijalar (qayta o'rnatishdan keyin tiklash)
 *  PUT /api/student/day-tests {res,prep,done,err} -> birlashtiradi va qaytaradi (takror yuborish xavfsiz)
 */
const TestState = require('../models/TestState');
const { mergeTests } = require('../lib/testMerge');
const MAX_BYTES = 200 * 1024;

const getTests = async (req, res) => {
  try {
    const d = await TestState.findOne({ user: req.user._id }).lean();
    res.status(200).json({ state: d ? { res: d.res, prep: d.prep, done: d.done, err: d.err } : null });
  } catch (e) { console.error('getTests xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};
const putTests = async (req, res) => {
  try {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ message: "Ma'lumot noto'g'ri" });
    if (Buffer.byteLength(JSON.stringify(b)) > MAX_BYTES) return res.status(413).json({ message: "Ma'lumot juda katta" });
    const cur = await TestState.findOne({ user: req.user._id }).lean();
    const merged = mergeTests(cur, b);
    await TestState.updateOne({ user: req.user._id }, { $set: merged }, { upsert: true });
    res.status(200).json({ state: merged });
  } catch (e) { console.error('putTests xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};
module.exports = { getTests, putTests };
