const mongoose = require('mongoose');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const ExamAttempt = require('../models/ExamAttempt');
const { parseUnitTextWithAI } = require('../services/geminiService');
const { advanceDay, itemsForDay } = require('./studentController');
const DayMastery = require('../models/DayMastery');
const ExerciseProgress = require('../models/ExerciseProgress');
const Attendance = require('../models/Attendance');
const PracticeItem = require('../models/PracticeItem');
const HomeworkSubmission = require('../models/HomeworkSubmission');
const Homework = require('../models/Homework');
const { publicUser, GROUPS } = require('./authController');
const { endOfMonth, endOfLocalDay } = require('../lib/subscription');
const CourseState = require('../models/CourseState');
const { summarize, levelForCourseDay } = require('../lib/courseMerge');
const COURSE_DAYS = 450;
const { dayProgressForUsers, courseProgressPercent } = require('../services/progressService');
const {
  TOTAL_DAYS,
  isValidDay,
  deriveLessonType,
  levelForDay,
} = require('../config/curriculum');

/** :id parametri Mongo _id yoki eski Supabase uuid (legacy_id) bo'lishi mumkin — ilova ikkinchisini biladi. */
async function findStudent(idParam) {
  if (mongoose.isValidObjectId(idParam)) {
    const byId = await User.findById(idParam);
    if (byId) return byId;
  }
  return User.findOne({ legacy_id: idParam });
}

/** GET /api/admin/students?group=1-guruh */
const listStudents = async (req, res) => {
  try {
    const filter = { role: 'student' };
    if (req.query.group) filter.group_name = String(req.query.group);
    const students = await User.find(filter).select('-password_hash').sort({ full_name: 1 });
    // O'qituvchi jadvali: har o'quvchi uchun joriy kun progressi (foiz, birinchi urinish aniqligi, xatolar) + to'lov holati
    const progress = await dayProgressForUsers(students);
    res.status(200).json({
      students: students.map((u) => {
        const p = progress.get(String(u._id)) || null;
        return { ...publicUser(u), today: p, course_percent: courseProgressPercent(u.current_day, p?.percent) };
      }),
    });
  } catch (error) {
    console.error('listStudents xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/pay      { months?: 1..12 }  yoki  { end_date: 'YYYY-MM-DD' }
 *
 * "To'lov qabul qilindi" tugmasi. Obuna TAQVIM OYI oxirigacha ochiladi:
 *   months=1 -> shu oyning oxirigacha, months=2 -> keyingi oyning oxirigacha (oldindan to'lov), ...
 *   end_date -> istisno holatlar uchun aniq sana (kunning oxirigacha, Toshkent vaqti).
 * status 'active' bo'ladi (bloklangan bo'lsa ham ochiladi); current_day O'ZGARMAYDI.
 * Idempotent: shu muddatga allaqachon to'langan bo'lsa 409 (qo'sh bosishda muddat qisqarib ketmasin).
 * Bu yo'l faqat admin uchun (adminRoutes: protect + adminOnly).
 */
const recordPayment = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student) return res.status(404).json({ message: "O'quvchi topilmadi" });

    const now = new Date();
    let target;
    let kind = 'month';
    let months = null;

    if (req.body?.end_date !== undefined) {
      kind = 'custom';
      target = endOfLocalDay(req.body.end_date);
      if (!target) return res.status(400).json({ message: "Sana noto'g'ri. Format: YYYY-MM-DD" });
      if (target <= now) return res.status(400).json({ message: "Sana kelajakda bo'lishi kerak" });
    } else {
      months = req.body?.months === undefined ? 1 : Number(req.body.months);
      if (!Number.isInteger(months) || months < 1 || months > 12) {
        return res.status(400).json({ message: "months 1 dan 12 gacha butun son bo'lishi kerak" });
      }
      target = endOfMonth(now, months - 1);
      const current = student.subscription_end_date;
      if (student.status === 'active' && current && target <= current) {
        return res.status(409).json({
          message: "Obuna allaqachon shu muddatgacha to'langan",
          subscription_end_date: current,
        });
      }
    }

    student.status = 'active';
    student.subscription_end_date = target;
    const rawAmount = req.body?.amount;
    let amount;
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
      amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) return res.status(400).json({ message: "Summa noto'g'ri" });
    }
    const note = req.body?.note ? String(req.body.note).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : undefined;
    student.payments.push({ paid_at: now, paid_through: target, kind, months, amount, note, by: req.user._id });
    if (student.payments.length > 60) student.payments = student.payments.slice(-60);
    await student.save();

    res.status(200).json({ message: "To'lov qayd etildi, obuna ochildi", student: publicUser(student) });
  } catch (error) {
    console.error('recordPayment xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** Eski yo'l: POST /students/:id/unblock — endi "shu oy uchun to'lov" bilan bir xil (eski ilovalar sinmasin) */
const unblockStudent = (req, res) => {
  req.body = { months: 1 };
  return recordPayment(req, res);
};

/**
 * POST /api/admin/students/:id/approve-speaking   ("Speakingdan o'tdi" tugmasi)
 * Faqat o'quvchi final_exam kunida (daraja oxirgi kuni) turgan bo'lsa ishlaydi.
 * current_day +1 bo'ladi -> keyingi daraja ochiladi (daraja kun raqamidan hisoblanadi).
 */
const approveSpeakingExam = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student) return res.status(404).json({ message: "O'quvchi topilmadi" });

    const day = student.current_day;
    if (day > TOTAL_DAYS || deriveLessonType(day) !== 'final_exam') {
      return res.status(400).json({ message: "O'quvchi hozir final_exam kunida emas" });
    }

    const updated = await advanceDay(student._id, day);
    if (!updated) {
      return res.status(409).json({ message: "Bu o'quvchi allaqachon tasdiqlangan yoki kuni o'zgargan" });
    }

    const plan = await StudyPlan.findOne({ day_number: day }).select('_id');
    await ExamAttempt.create({
      user: student._id,
      study_plan_day: plan?._id,
      day_number: day,
      lesson_type: 'final_exam',
      passed: true,
      speaking_approved_by_admin: true,
      speaking_approved_at: new Date(),
      speaking_approved_by: req.user._id,
    });

    res.status(200).json({
      message: "Speaking imtihoni tasdiqlandi. O'quvchi keyingi bosqichga o'tdi.",
      student: publicUser(updated),
    });
  } catch (error) {
    console.error('approveSpeakingExam xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/parse-unit  { rawText, day_number, unit_title? }
 * Daraja va dars turi kun raqamidan avtomatik aniqlanadi. Natija StudyPlan'ga saqlanadi (upsert).
 */
const parseUnitWithAI = async (req, res) => {
  try {
    const { rawText, unit_title } = req.body;
    const day_number = Number(req.body.day_number);

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 20) {
      return res.status(400).json({ message: "rawText (Unit matni) majburiy va juda qisqa bo'lmasligi kerak" });
    }
    if (!isValidDay(day_number)) {
      return res.status(400).json({ message: `day_number 1 dan ${TOTAL_DAYS} gacha butun son bo'lishi kerak` });
    }

    const lessonType = deriveLessonType(day_number);
    const ai = await parseUnitTextWithAI(rawText, lessonType);

    const saved = await StudyPlan.findOneAndUpdate(
      { day_number },
      {
        day_number,
        unit_title: unit_title || ai.unit_title || `Unit ${day_number}`,
        vocabulary: ai.vocabulary.map((v) => ({ ...v })),
        quizzes: ai.quizzes,
        fill_in_the_blanks: ai.fill_in_the_blanks,
        speaking_questions: ai.speaking_questions,
        needs_content: false,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ message: 'Unit AI orqali qayta ishlandi va bazaga saqlandi', study_plan_day: saved });
  } catch (error) {
    console.error('parseUnitWithAI xatosi:', error);
    res.status(500).json({ message: `AI parser xatosi: ${error.message}` });
  }
};

/** GET /api/admin/students/:id */
const getStudentDetails = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student) return res.status(404).json({ message: "O'quvchi topilmadi" });
    const attempts = await ExamAttempt.find({ user: student._id }).sort({ createdAt: -1 }).limit(20);
    res.status(200).json({ student: publicUser(student), payments: student.payments, recent_attempts: attempts });
  } catch (error) {
    console.error('getStudentDetails xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** DELETE /api/admin/students/:id — ilovadagi "Chiqarish" tugmasi bilan birga (Supabase qatori ilovadan o'chiriladi). */
const deleteStudent = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student) return res.status(200).json({ message: "O'quvchi allaqachon o'chirilgan" });
    if (student.role !== 'student') return res.status(400).json({ message: "Adminni bu yerdan o'chirib bo'lmaydi" });
    await ExamAttempt.deleteMany({ user: student._id });
    await Promise.all([
      require('../models/Attendance').deleteMany({ user: student._id }),
      require('../models/HomeworkSubmission').deleteMany({ user: student._id }),
      require('../models/Message').deleteMany({ $or: [{ from: student._id }, { to: student._id }] }),
      require('../models/PracticeItem').deleteMany({ user: student._id }),
      require('../models/PracticeDay').deleteMany({ user: student._id }),
    ]);
    await User.deleteOne({ _id: student._id });
    res.status(200).json({ message: "O'quvchi o'chirildi" });
  } catch (error) {
    console.error('deleteStudent xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * GET /api/admin/students/:id/card — o'quvchi kartochkasi: to'lov, davomat, o'zlashtirish, test va mashq natijalari bitta joyda.
 */
const studentCard = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student || student.role !== 'student') return res.status(404).json({ message: "O'quvchi topilmadi" });
    const uid = student._id;

    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const [attRows, mastery, exams, hwSubs] = await Promise.all([
      Attendance.find({ user: uid, date: { $gte: since } }).sort({ date: -1 }).lean(),
      DayMastery.find({ user: uid }).sort({ day_number: -1 }).limit(60).lean(),
      ExamAttempt.find({ user: uid }).sort({ createdAt: -1 }).limit(30).lean(),
      HomeworkSubmission.find({ user: uid }).lean(),
    ]);
    const hws = await Homework.find({ _id: { $in: hwSubs.map((h) => h.homework) } }).select('title').lean();
    const hwTitle = new Map(hws.map((h) => [String(h._id), h.title]));

    // Mashq natijalari: oxirgi 14 kun bo'yicha jamlanma + eng qiyin savollar
    const from = Math.max(1, student.current_day - 14);
    const prog = await ExerciseProgress.find({ user: uid, day_number: { $gte: from } }).lean();
    const perDay = new Map();
    for (const p of prog) {
      const d = perDay.get(p.day_number) || { day: p.day_number, answered: 0, done: 0, first_try: 0, wrong: 0, attempts: 0 };
      d.answered++; d.attempts += p.attempts || 0; d.wrong += p.wrong || 0;
      if (p.status === 'done') { d.done++; if (p.first_try) d.first_try++; }
      perDay.set(p.day_number, d);
    }
    // Eng qiyin savollar: PracticeItem'dan (mavzu qayta o'tilganda ham o'chmaydi, hamma vaqt bo'yicha)
    const hardKeys = await PracticeItem.find({ user: uid, wrong_total: { $gt: 0 } }).sort({ wrong_total: -1 }).limit(10).lean();
    const itemCache = new Map();
    const hard = [];
    for (const p of hardKeys) {
      if (!itemCache.has(p.day_number)) itemCache.set(p.day_number, await itemsForDay(p.day_number));
      const it = itemCache.get(p.day_number).find((i) => i.key === p.key);
      if (it) hard.push({ day: p.day_number, wrong: p.wrong_total, question: it.question, answer: it.kind === 'mcq' ? it.options[it.correct_index] : it.correct_word });
    }

    const cs = await CourseState.findOne({ user: student._id }).select('course_day days_done points accuracy week_points last_study_date state updatedAt override').lean();
    const csDays = cs && cs.state && cs.state.d ? Object.entries(cs.state.d).filter(([, v]) => v && v.c).map(([k, v]) => ({ day: Number(k) + 1, test: v.t == null ? null : v.t })).sort((x, y) => y.day - x.day).slice(0, 30) : [];
    const course = cs ? { course_day: cs.course_day, days_done: cs.days_done, points: cs.points, accuracy: cs.accuracy, week_points: cs.week_points, last_study_date: cs.last_study_date, synced_at: cs.updatedAt, recent_days: csDays, override_pending: !!cs.override } : null;
    res.status(200).json({
      course,
      student: publicUser(student),
      payments: student.payments,
      attendance: {
        present: attRows.filter((a) => a.status === 'present').length,
        absent: attRows.filter((a) => a.status === 'absent').length,
        late: attRows.filter((a) => a.status === 'late').length,
        excused: attRows.filter((a) => a.status === 'excused').length,
        days: attRows.map((a) => ({ date: a.date, status: a.status })),
      },
      mastery: mastery.map((m) => ({ day: m.day_number, passes: m.passes, last_percent: m.last_percent, best_percent: m.best_percent, mastered: m.mastered, needs_teacher: m.needs_teacher, teacher_passed: m.teacher_passed })),
      exercises_by_day: [...perDay.values()].sort((a, b) => b.day - a.day).map((d) => ({ ...d, first_try_percent: d.answered ? Math.round((d.first_try / d.answered) * 100) : 0 })),
      hardest: hard,
      exams: exams.map((e) => ({ day: e.day_number, type: e.lesson_type, attempt: e.attempt_number, correct: e.correct_count, total: e.total_count, percent: e.score_percent, passed: e.passed, wrong_keys: e.wrong_keys, at: e.createdAt })),
      homework: hwSubs.map((h) => ({ title: hwTitle.get(String(h.homework)) || '—', submitted: h.submitted, on_time: h.on_time, image_url: h.image_url, at: h.submitted_at })),
    });
  } catch (error) {
    console.error('studentCard xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/pass-day — o'qituvchi o'quvchini joriy (oddiy) kundan qo'lda o'tkazadi
 * (mavzu qayta-qayta o'zlashtirilmasa yoki o'qituvchi sinfda o'zi tekshirgan bo'lsa).
 */
const passCurrentDay = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student || student.role !== 'student') return res.status(404).json({ message: "O'quvchi topilmadi" });
    const day = student.current_day;
    if (day > TOTAL_DAYS || deriveLessonType(day) !== 'regular') {
      return res.status(400).json({ message: "Bu kun oddiy dars emas (imtihon kunlari boshqacha o'tkaziladi)" });
    }
    const updated = await advanceDay(student._id, day);
    if (!updated) return res.status(409).json({ message: "O'quvchining kuni allaqachon o'zgargan" });
    await DayMastery.updateOne({ user: student._id, day_number: day }, { $set: { mastered: true, teacher_passed: true, needs_teacher: false, mastered_at: new Date() } }, { upsert: true });
    await ExerciseProgress.deleteMany({ user: student._id, day_number: day });
    res.status(200).json({ message: `${day}-kun o'qituvchi tomonidan o'tkazildi`, student: publicUser(updated) });
  } catch (error) {
    console.error('passCurrentDay xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/set-day  { day }
 * O'qituvchi o'quvchining kursdagi kunini qo'lda belgilaydi (masalan eski tizimdan ko'chgan yoki sinfda boshqa joyga o'tgan bola uchun).
 * 1..TOTAL_DAYS (TOTAL_DAYS+1 = kurs tugagan). Daraja kundan hisoblanadi; joriy kunning yarim qolgan mashqlari tozalanadi.
 */
const setStudentDay = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student || student.role !== 'student') return res.status(404).json({ message: "O'quvchi topilmadi" });
    const day = Number(req.body?.day);
    if (!Number.isInteger(day) || day < 1 || day > COURSE_DAYS) return res.status(400).json({ message: `Kun 1 dan ${COURSE_DAYS} gacha butun son bo'lishi kerak` });
    // 450 kunlik kurs: kun serverda saqlanadi, telefon internet bo'lganda qabul qiladi (o'tilgan kunlar va ballar o'chmaydi)
    const cur = await CourseState.findOne({ user: student._id }).lean();
    const state = { ...((cur && cur.state) || {}), u: day - 1 };
    const sum = summarize(state);
    const override = { day, id: String(Date.now()), at: new Date() };
    await CourseState.updateOne({ user: student._id }, { $set: { state, ...sum, override } }, { upsert: true });
    await User.updateOne({ _id: student._id }, { $set: {
      course_day: day, current_day: day, level: levelForCourseDay(day), placement_pending: false, last_active_at: new Date(),
    } });
    res.status(200).json({ message: `Kun ${day} ga o'rnatildi. O'quvchi ilovani internet bilan ochganda qabul qiladi.`, student: publicUser(await User.findById(student._id)) });
  } catch (error) {
    console.error('setStudentDay xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/placement  { group_name?, day?, confirm? }
 * Yangi o'quvchini joylash: guruh belgilash ('' = guruhsiz) va/yoki boshlang'ich kunni o'zgartirish; tasdiqlangach belgi olinadi.
 */
const placeStudent = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student || student.role !== 'student') return res.status(404).json({ message: "O'quvchi topilmadi" });
    const set = { placement_pending: false };
    if (req.body?.group_name !== undefined) {
      const g = String(req.body.group_name || '').trim();
      if (g && !GROUPS.includes(g)) return res.status(400).json({ message: "Guruh noto'g'ri" });
      set.group_name = g || null;
    }
    const day = req.body?.day;
    if (day !== undefined && day !== null && day !== '') {
      const d = Number(day);
      if (!Number.isInteger(d) || d < 1 || d > TOTAL_DAYS) return res.status(400).json({ message: `Kun 1 dan ${TOTAL_DAYS} gacha bo'lishi kerak` });
      set.current_day = d;
      set.level = levelForDay(d);
      await ExerciseProgress.deleteMany({ user: student._id, day_number: { $gte: d } });
    }
    await User.updateOne({ _id: student._id }, { $set: set });
    res.status(200).json({ message: "O'quvchi joylandi", student: publicUser(await User.findById(student._id)) });
  } catch (error) {
    console.error('placeStudent xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** O'quvchining yozgan (Writing) va aytgan (Speaking) javoblari — o'qituvchi ko'rib chiqishi uchun */
const studentWritings = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: "O'quvchi topilmadi" });
    const rows = await ExerciseProgress.find({ user: req.params.id, answer_text: { $exists: true, $ne: '' } })
      .sort({ done_at: -1 }).limit(60).select('day_number key answer_text done_at lenient').lean();
    res.status(200).json({
      writings: rows.map((r) => ({
        day_number: r.day_number, kind: /:sp:/.test(r.key) ? 'speaking' : 'writing', text: r.answer_text, done_at: r.done_at, lenient: !!r.lenient,
      })),
    });
  } catch (error) {
    console.error('studentWritings xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { placeStudent, studentWritings, setStudentDay, studentCard, passCurrentDay, listStudents, recordPayment, unblockStudent, approveSpeakingExam, parseUnitWithAI, getStudentDetails, deleteStudent };
