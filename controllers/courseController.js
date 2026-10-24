/**
 * 450 kunlik kurs: telefon bilan sinxronlash.
 *  GET /api/student/course  -> serverdagi holat (yangi telefon/qayta o'rnatishdan keyin tiklash uchun)
 *  PUT /api/student/course  { state } -> serverdagi bilan BIRLASHTIRADI, birlashgan holatni qaytaradi
 * Ilova internetsiz ishlaydi; internet bo'lganda shu yerga yuboradi. Takror yuborish xavfsiz.
 */
const User = require('../models/User');
const CourseState = require('../models/CourseState');
const { mergeState, summarize, levelForCourseDay } = require('../lib/courseMerge');

const MAX_BYTES = 600 * 1024;

const getCourse = async (req, res) => {
  try {
    const doc = await CourseState.findOne({ user: req.user._id }).lean();
    res.status(200).json({ state: doc ? doc.state : null, override: doc && doc.override ? { day: doc.override.day, id: doc.override.id } : null, summary: doc ? summarize(doc.state) : null, server_time: new Date().toISOString() });
  } catch (e) { console.error('getCourse xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

const putCourse = async (req, res) => {
  try {
    const client = req.body && req.body.state;
    if (!client || typeof client !== 'object' || Array.isArray(client)) return res.status(400).json({ message: "Ma'lumot noto'g'ri" });
    if (Buffer.byteLength(JSON.stringify(client)) > MAX_BYTES) return res.status(413).json({ message: "Ma'lumot juda katta" });
    const cur = await CourseState.findOne({ user: req.user._id }).lean();
    const merged = mergeState(cur ? cur.state : {}, client);
    // O'qituvchi kun belgilagan bo'lsa: telefon qabul qilganini bildirguncha (ack_override) kun majburlanadi
    const ov = cur && cur.override;
    const acked = ov && String(req.body.ack_override || '') === String(ov.id);
    if (ov && !acked) merged.u = Number(ov.day) - 1;
    const sum = summarize(merged);
    await CourseState.updateOne(
      { user: req.user._id },
      { $set: { state: merged, ...sum, client_saved_at: new Date(), ...(acked ? { override: null } : {}) } },
      { upsert: true }
    );
    await User.updateOne({ _id: req.user._id }, { $set: {
      course_day: sum.course_day, course_days_done: sum.days_done, course_points: sum.points,
      course_accuracy: sum.accuracy, level: levelForCourseDay(sum.course_day), current_day: sum.course_day || 1, course_last_date: sum.last_study_date, last_active_at: new Date(),
    } });
    res.status(200).json({ state: merged, override: ov && !acked ? { day: ov.day, id: ov.id } : null, summary: sum, server_time: new Date().toISOString() });
  } catch (e) { console.error('putCourse xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

module.exports = { getCourse, putCourse };
