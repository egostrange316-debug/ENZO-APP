const mongoose = require('mongoose');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const ExamAttempt = require('../models/ExamAttempt');
const { parseUnitTextWithAI } = require('../services/geminiService');
const { advanceDay } = require('./studentController');
const { publicUser } = require('./authController');
const {
  TOTAL_DAYS,
  SUBSCRIPTION_DAYS,
  isValidDay,
  deriveLessonType,
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
    res.status(200).json({ students: students.map(publicUser) });
  } catch (error) {
    console.error('listStudents xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/unblock
 * status -> 'active', muddat bugundan +30 kun. current_day O'ZGARMAYDI.
 */
const unblockStudent = async (req, res) => {
  try {
    const student = await findStudent(req.params.id);
    if (!student) return res.status(404).json({ message: "O'quvchi topilmadi" });

    student.status = 'active';
    student.subscription_end_date = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
    await student.save();

    res.status(200).json({ message: "O'quvchi blokdan chiqarildi", student: publicUser(student) });
  } catch (error) {
    console.error('unblockStudent xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/students/:id/approve-speaking   ("Speakingdan o'tdi" tugmasi)
 * Faqat o'quvchi final_exam kunida (100/200/300/400) turgan bo'lsa ishlaydi.
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
    res.status(200).json({ student: publicUser(student), recent_attempts: attempts });
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
    await User.deleteOne({ _id: student._id });
    res.status(200).json({ message: "O'quvchi o'chirildi" });
  } catch (error) {
    console.error('deleteStudent xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { listStudents, unblockStudent, approveSpeakingExam, parseUnitWithAI, getStudentDetails, deleteStudent };
