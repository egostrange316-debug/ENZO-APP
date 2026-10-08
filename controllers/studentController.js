const StudyPlan = require('../models/StudyPlan');
const ExamAttempt = require('../models/ExamAttempt');
const User = require('../models/User');
const { evaluateSubscription } = require('../middleware/checkSubscription');
const { publicUser } = require('./authController');
const {
  TOTAL_DAYS,
  PASS_THRESHOLD_PERCENT,
  levelForDay,
  deriveLessonType,
} = require('../config/curriculum');

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * current_day ni ATOMIK ravishda +1 qiladi. Filtrda joriy kun ham bor — shuning uchun bir vaqtda
 * ikki so'rov kelsa (qo'sh bosish, ikki qurilma) faqat bittasi kunni oshiradi.
 * Qaytaradi: yangilangan user yoki null (kimdir allaqachon oshirgan).
 */
async function advanceDay(userId, fromDay) {
  const newDay = fromDay + 1;
  return User.findOneAndUpdate(
    { _id: userId, current_day: fromDay },
    {
      $set: {
        current_day: newDay,
        level: levelForDay(Math.min(newDay, TOTAL_DAYS)),
        last_active_at: new Date(),
      },
    },
    { new: true }
  );
}

/** GET /api/student/me — bloklangan bo'lsa ham javob beradi (ilova "Bloklangan" ekranini ko'rsatishi uchun). */
const getMe = async (req, res) => {
  try {
    await evaluateSubscription(req.user);
    res.status(200).json({ user: publicUser(req.user) });
  } catch (error) {
    console.error('getMe xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** Imtihon kunlarida to'g'ri javoblarni bolaga YUBORMAYMIZ — baholash serverda. */
const stripAnswers = (plan) => ({
  quizzes: plan.quizzes.map((q) => ({ question: q.question, options: q.options })),
  fill_in_the_blanks: plan.fill_in_the_blanks.map((f) => ({
    sentence_with_blank: f.sentence_with_blank,
    options: f.options,
  })),
});

/**
 * GET /api/student/lesson/today
 *  - regular    : vocabulary + mashqlar (javoblar bilan — bu kunda baholash yo'q)
 *  - mini/mid   : vocabulary + savollar (to'g'ri javobsiz)
 *  - final_exam : FAQAT speaking_questions
 */
const getTodayLesson = async (req, res) => {
  try {
    const user = req.user;
    const day = user.current_day;

    if (day > TOTAL_DAYS) {
      return res.status(200).json({ completed: true, message: 'Tabriklaymiz! Siz butun kursni tugatdingiz.' });
    }

    const plan = await StudyPlan.findOne({ day_number: day });
    if (!plan) {
      return res.status(404).json({ message: `${day}-kun darsi hali tayyorlanmagan` });
    }

    const base = {
      day_number: plan.day_number,
      level: plan.level,
      unit_title: plan.unit_title,
      lesson_type: plan.lesson_type,
      pass_threshold_percent: PASS_THRESHOLD_PERCENT,
    };

    if (plan.lesson_type === 'final_exam') {
      return res.status(200).json({
        ...base,
        speaking_questions: plan.speaking_questions,
        note: "Bu darajaning yakuniy imtihon kuni. Speaking imtihonini o'qituvchi offline tekshiradi.",
      });
    }

    if (plan.needs_content) {
      return res.status(404).json({ message: `${day}-kun darsi hali tayyorlanmagan` });
    }

    if (plan.lesson_type === 'regular') {
      return res.status(200).json({
        ...base,
        vocabulary: plan.vocabulary,
        quizzes: plan.quizzes,
        fill_in_the_blanks: plan.fill_in_the_blanks,
      });
    }

    return res.status(200).json({ ...base, vocabulary: plan.vocabulary, ...stripAnswers(plan) });
  } catch (error) {
    console.error('getTodayLesson xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** POST /api/student/lesson/complete — faqat 'regular' kun uchun. */
const completeRegularLesson = async (req, res) => {
  try {
    const day = req.user.current_day;

    // Qo'sh bosish / eskirgan ekran himoyasi: klient QAYSI kunni tugatayotganini aytadi.
    if (Number(req.body.day_number) !== day) {
      return res.status(409).json({ message: "Dars holati o'zgargan. Yangilab qayta urinib ko'ring.", new_current_day: day });
    }

    if (day > TOTAL_DAYS || deriveLessonType(day) !== 'regular') {
      return res.status(400).json({
        message: "Bu kun oddiy dars emas — imtihon kunlari /exam/submit orqali (yoki Admin tasdig'i bilan) yakunlanadi",
      });
    }
    if (!(await StudyPlan.exists({ day_number: day }))) {
      return res.status(404).json({ message: 'Joriy kun darsi topilmadi' });
    }

    const updated = await advanceDay(req.user._id, day);
    if (!updated) {
      const fresh = await User.findById(req.user._id);
      return res.status(409).json({ message: 'Bu dars allaqachon yakunlangan', new_current_day: fresh.current_day });
    }

    return res.status(200).json({ message: 'Dars muvaffaqiyatli yakunlandi', new_current_day: updated.current_day });
  } catch (error) {
    console.error('completeRegularLesson xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/student/exam/submit
 * Body: { day_number: number, quiz_answers: number[], fill_answers: string[] }  — tartib savollar tartibi bilan bir xil.
 *
 * Ball SERVERDA hisoblanadi (klient "men 10 tadan 10 ta topdim" deb yubora olmaydi).
 * >= 70% -> current_day +1, aks holda o'zgarmaydi.
 */
const submitExamScore = async (req, res) => {
  try {
    const user = req.user;
    const day = user.current_day;

    if (day > TOTAL_DAYS) return res.status(400).json({ message: 'Kurs allaqachon tugagan' });

    if (Number(req.body.day_number) !== day) {
      return res.status(409).json({ message: "Imtihon holati o'zgargan. Yangilab qayta urinib ko'ring.", new_current_day: day });
    }

    const plan = await StudyPlan.findOne({ day_number: day });
    if (!plan) return res.status(404).json({ message: 'Joriy kun darsi topilmadi' });

    if (!['mini_check', 'mid_check'].includes(plan.lesson_type)) {
      return res.status(400).json({
        message: `Bu endpoint faqat mini_check/mid_check kunlari uchun. Joriy kun turi: '${plan.lesson_type}'`,
      });
    }

    const quizAnswers = Array.isArray(req.body.quiz_answers) ? req.body.quiz_answers : [];
    const fillAnswers = Array.isArray(req.body.fill_answers) ? req.body.fill_answers : [];

    const total = plan.quizzes.length + plan.fill_in_the_blanks.length;
    if (total === 0) {
      return res.status(409).json({ message: "Bu kun uchun imtihon savollari hali kiritilmagan" });
    }

    let correct = 0;
    plan.quizzes.forEach((q, i) => {
      if (Number.isInteger(quizAnswers[i]) && quizAnswers[i] === q.correct_answer_index) correct++;
    });
    plan.fill_in_the_blanks.forEach((f, i) => {
      if (norm(fillAnswers[i]) === norm(f.correct_word)) correct++;
    });

    const scorePercent = Math.round((correct / total) * 100);
    const passed = scorePercent >= PASS_THRESHOLD_PERCENT;

    await ExamAttempt.create({
      user: user._id,
      study_plan_day: plan._id,
      day_number: day,
      lesson_type: plan.lesson_type,
      score_percent: scorePercent,
      passed,
    });

    let newDay = day;
    if (passed) {
      const updated = await advanceDay(user._id, day);
      newDay = updated ? updated.current_day : (await User.findById(user._id)).current_day;
    }

    return res.status(200).json({
      passed,
      score_percent: scorePercent,
      correct_count: correct,
      total_count: total,
      threshold_percent: PASS_THRESHOLD_PERCENT,
      new_current_day: newDay,
      message: passed
        ? "Tabriklaymiz! Imtihondan o'tdingiz, keyingi kunga o'tdingiz."
        : `O'tish balli ${PASS_THRESHOLD_PERCENT}%. Qayta urinib ko'ring — shu kunni takrorlaysiz.`,
    });
  } catch (error) {
    console.error('submitExamScore xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { getMe, getTodayLesson, completeRegularLesson, submitExamScore, advanceDay };
