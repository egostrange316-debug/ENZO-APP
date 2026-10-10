const StudyPlan = require('../models/StudyPlan');
const ExamAttempt = require('../models/ExamAttempt');
const User = require('../models/User');
const ExerciseProgress = require('../models/ExerciseProgress');
const DayMastery = require('../models/DayMastery');
const BookMaterial = require('../models/BookMaterial');
const { dayProgressForUsers, courseProgressPercent } = require('../services/progressService');
const { buildDayItems } = require('../services/dayItemsService');
const { recordMistake } = require('../lib/practiceLog');
const ex = require('../services/exerciseService');
const game = require('../services/gameService');
const { evaluateSubscription } = require('../middleware/checkSubscription');
const { publicUser } = require('./authController');
const {
  TOTAL_DAYS,
  PASS_THRESHOLD_PERCENT,
  MASTERY_THRESHOLD_PERCENT,
  MASTERY_TEACHER_AFTER,
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

/** Mavzu qayta o'tilayotgan bo'lsa ilova buni bolaga tushuntiradi */
async function masteryInfo(userId, day) {
  const m = await DayMastery.findOne({ user: userId, day_number: day }).lean();
  if (!m || !m.passes) return { retry: false, threshold_percent: MASTERY_THRESHOLD_PERCENT };
  return { retry: !m.mastered, passes: m.passes, last_percent: m.last_percent, threshold_percent: MASTERY_THRESHOLD_PERCENT };
}

/** (user, day) bo'yicha savol holatlari. Hujjati yo'q savol = 'pending' (hech narsa oldindan yaratilmaydi). */
async function loadStates(userId, day) {
  return ExerciseProgress.find({ user: userId, day_number: day }).lean();
}

const exercisesPayload = (items, states) => {
  const byKey = new Map(states.map((s) => [s.key, s]));
  return items.map((it) => ex.publicItem(it, byKey.get(it.key)));
};


/** Shu kunga biriktirilgan tayyor kitob to'plamlari (faqat oddiy kunlarda) */
const booksForDay = (plan) =>
  plan.lesson_type === 'regular'
    ? BookMaterial.find({ assigned_day: plan.day_number, status: 'ready' }).sort({ createdAt: 1 }).lean()
    : Promise.resolve([]);

/** Kunning hamma mashqlari: reja + biriktirilgan kitoblar. Imtihon kunlarida faqat reja. */
async function dayItems(plan, books) {
  return buildDayItems(plan, books || (await booksForDay(plan)));
}

/** Kitobdan o'qish/tinglash/gapirish uchun kontent (baholanmaydi): lug'at, grammatika, matn, ssenariy, Speaking savollari */
const bookSections = (books) =>
  books.map((b) => ({
    book_id: b._id,
    title: b.title,
    book_ref: b.book_ref?.label ? b.book_ref : null,
    writing: {
      vocabulary: b.writing?.vocabulary || [],
      grammar: (b.writing?.grammar || []).map((g) => ({ title: g.title, title_uz: g.title_uz, explanation_uz: g.explanation_uz, forms: g.forms || [], examples: g.examples, mistakes: g.mistakes || [] })),
    },
    reading: b.reading ? { title: b.reading.title, text: b.reading.text, key_words: b.reading.key_words } : null,
    listening: b.listening ? { title: b.listening.title, script: b.listening.script } : null, // ilova TTS bilan o'qib beradi
    speaking: { questions: b.speaking?.questions || [] },
  }));

/** "Bugun kitobda: ..., N-bet" — kitob bilan birga ishlaydigan o'qituvchi/o'quvchi uchun */
const bookToday = (books) => {
  const b = (books || []).find((x) => x.book_ref?.label);
  return b ? { ...b.book_ref } : null;
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const practiceKey = (attemptNumber, itemKey) => `p${attemptNumber}:${itemKey}`;

/**
 * Imtihon kunining holati (mini_check / mid_check):
 *  phase 'exam'     — imtihon topshirish mumkin
 *  phase 'practice' — oxirgi urinishda yiqilgan: avval xato qilingan savollar bo'yicha mini-mashq
 *                     (to'g'ri bo'lguncha takrorlanadi), keyin qayta topshiradi.
 */
async function examState(userId, day, plan, items) {
  const attempts = await ExamAttempt.find({ user: userId, day_number: day, lesson_type: plan.lesson_type })
    .sort({ attempt_number: 1 })
    .lean();
  const last = attempts[attempts.length - 1];
  const scores = attempts.map((a) => a.score_percent || 0);
  const state = {
    attempts_count: attempts.length,
    next_attempt_number: attempts.length + 1,
    first_attempt_percent: attempts.length ? scores[0] : null,
    last_attempt_percent: attempts.length ? scores[scores.length - 1] : null,
    best_percent: attempts.length ? Math.max(...scores) : null,
    phase: 'exam',
    practice_items: [],
    practice_states: [],
    practice_progress: null,
    last,
  };
  if (last && !last.passed && last.wrong_keys && last.wrong_keys.length) {
    const wrong = new Set(last.wrong_keys);
    state.practice_items = items
      .filter((it) => wrong.has(it.key))
      .map((it) => ({ ...it, key: practiceKey(last.attempt_number, it.key) }));
    if (state.practice_items.length) {
      state.practice_states = await loadStates(userId, day);
      state.practice_progress = ex.summarize(state.practice_items, state.practice_states);
      if (!state.practice_progress.complete) state.phase = 'practice';
    }
  }
  return state;
}

const examSummary = (st, threshold) => ({
  phase: st.phase,
  attempt_number: st.next_attempt_number,
  attempts_count: st.attempts_count,
  first_attempt_percent: st.first_attempt_percent,
  last_attempt_percent: st.last_attempt_percent,
  best_percent: st.best_percent,
  pass_threshold_percent: threshold,
});

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
      // To'g'ri javoblar bolaga YUBORILMAYDI: har javob serverda tekshiriladi (POST /exercise/answer)
      const books = await booksForDay(plan);
      const items = await dayItems(plan, books);
      const states = await loadStates(user._id, day);
      return res.status(200).json({
        ...base,
        vocabulary: plan.vocabulary,
        ...stripAnswers(plan),
        book_today: bookToday(books),
        book_sections: bookSections(books),
        exercises: exercisesPayload(items, states),
        progress: ex.summarize(items, states),
        mastery: await masteryInfo(user._id, day),
      });
    }

    // mini_check / mid_check
    const items = ex.itemsFromPlan(plan);
    const st = await examState(user._id, day, plan, items);
    const payload = { ...base, vocabulary: plan.vocabulary, ...stripAnswers(plan), exam: examSummary(st, PASS_THRESHOLD_PERCENT) };
    if (st.phase === 'practice') {
      payload.practice = {
        exercises: exercisesPayload(st.practice_items, st.practice_states),
        progress: st.practice_progress,
      };
    } else {
      // Har urinishda savollar tartibi aralashtiriladi (javoblarni yodlab olish qiyinlashadi)
      payload.exam_items = shuffle(items).map((it) => ex.publicItem(it));
    }
    return res.status(200).json(payload);
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
    const plan = await StudyPlan.findOne({ day_number: day });
    if (!plan) {
      return res.status(404).json({ message: 'Joriy kun darsi topilmadi' });
    }

    // Hamma mashq to'g'ri bajarilmaguncha kun yakunlanmaydi (savol yo'q kunlarda bu tekshiruv o'tadi)
    const items = await dayItems(plan);
    const summary = ex.summarize(items, await loadStates(req.user._id, day));
    if (!summary.complete) {
      return res.status(409).json({
        code: 'exercises_incomplete',
        message: "Avval hamma mashqni to'g'ri bajaring",
        progress: summary,
      });
    }

    // O'zlashtirish: birinchi urinishdagi to'g'ri javoblar yetarli bo'lmasa mavzu noldan qayta o'tiladi
    const mastery = summary.first_try_percent;
    const prev = await DayMastery.findOne({ user: req.user._id, day_number: day }).lean();
    const passes = (prev?.passes || 0) + 1;
    if (mastery < MASTERY_THRESHOLD_PERCENT) {
      await DayMastery.updateOne(
        { user: req.user._id, day_number: day },
        { $set: { passes, last_percent: mastery, best_percent: Math.max(prev?.best_percent || 0, mastery), mastered: false, needs_teacher: passes >= MASTERY_TEACHER_AFTER } },
        { upsert: true }
      );
      await ExerciseProgress.deleteMany({ user: req.user._id, day_number: day });
      return res.status(200).json({
        retry_required: true,
        mastery_percent: mastery,
        threshold_percent: MASTERY_THRESHOLD_PERCENT,
        passes,
        message: `Mavzu yaxshi o'zlashtirilmadi (${mastery}%). Keling, uni yana bir bor o'tamiz — keyingi safar yaxshiroq bo'ladi!`,
      });
    }

    const updated = await advanceDay(req.user._id, day);
    if (!updated) {
      const fresh = await User.findById(req.user._id);
      return res.status(409).json({ message: 'Bu dars allaqachon yakunlangan', new_current_day: fresh.current_day });
    }
    await DayMastery.updateOne(
      { user: req.user._id, day_number: day },
      { $set: { passes, last_percent: mastery, best_percent: Math.max(prev?.best_percent || 0, mastery), mastered: true, needs_teacher: false, mastered_at: new Date() } },
      { upsert: true }
    );

    const words = items.filter((i) => i.section === 'vocab' && i.kind === 'fill').length;
    const reward = await game.onDayComplete(req.user._id, { wordsLearned: words });
    return res.status(200).json({ message: 'Dars muvaffaqiyatli yakunlandi', new_current_day: updated.current_day, reward });
  } catch (error) {
    console.error('completeRegularLesson xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * GET /api/student/progress — o'quvchining o'z progressi: bugungi vazifa foizi va kurs foizi.
 * (Bloklangan bo'lsa ham javob beradi, shuning uchun checkSubscription yo'q.)
 */
const getMyProgress = async (req, res) => {
  try {
    const user = req.user;
    const p = (await dayProgressForUsers([user])).get(String(user._id));
    res.status(200).json({
      day_number: user.current_day,
      level: user.level,
      today: p,
      course_percent: courseProgressPercent(user.current_day, p?.percent),
    });
  } catch (error) {
    console.error('getMyProgress xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * GET /api/student/leaderboard — hamma o'quvchilar ochiq ro'yxati: ism, guruh, kun, bugungi foiz, kurs foizi.
 * DIQQAT: to'lov/obuna holati bu yerda HECH QACHON yo'q — uni faqat o'qituvchi ko'radi.
 * Tartib: kurs foizi (kamayish), keyin ism.
 */
const getLeaderboard = async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('full_name group_name avatar current_day level').lean();
    const progress = await dayProgressForUsers(students);
    const rows = students
      .map((u) => {
        const p = progress.get(String(u._id));
        return {
          id: u._id,
          full_name: u.full_name,
          group_name: u.group_name,
          avatar: u.avatar,
          level: u.level,
          current_day: u.current_day,
          today_percent: p ? p.percent : 0,
          course_percent: courseProgressPercent(u.current_day, p?.percent),
          is_me: String(u._id) === String(req.user._id),
        };
      })
      .sort((a, b) => b.course_percent - a.course_percent || a.full_name.localeCompare(b.full_name));
    rows.forEach((r, i) => { r.rank = i + 1; });
    res.status(200).json({ leaderboard: rows });
  } catch (error) {
    console.error('getLeaderboard xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/student/exercise/answer   { day_number, key, answer }
 *   answer: test uchun variant indeksi (son), bo'sh joy uchun matn.
 * Javob SERVERDA tekshiriladi. To'g'ri bo'lsa savol 'done'. Noto'g'ri bo'lsa 'wrong' oshadi va savol
 * keyinroq yana beriladi (klient navbat oxiriga qo'yadi). Cheklov yo'q — istagancha urinadi.
 * Joriy kundan oldingi kunlar (takrorlash): holat saqlanmaydi, faqat to'g'ri/noto'g'ri qaytadi.
 */
const answerExercise = async (req, res) => {
  try {
    const user = req.user;
    const day = Number(req.body.day_number);
    const key = String(req.body.key || '');
    const answer = req.body.answer;

    if (!Number.isInteger(day) || day < 1 || day > TOTAL_DAYS) return res.status(400).json({ message: "Kun raqami noto'g'ri" });
    if (day > user.current_day) return res.status(403).json({ message: 'Bu kun hali ochilmagan' });

    const plan = await StudyPlan.findOne({ day_number: day });
    if (!plan) return res.status(404).json({ message: `${day}-kun darsi topilmadi` });
    let items = await dayItems(plan);
    if (plan.lesson_type !== 'regular' && day === user.current_day) {
      // Imtihon kunida faqat yiqilgandan keyingi mini-mashq (kalit: p<urinish>:<savol>) shu yerdan ishlaydi
      if (!['mini_check', 'mid_check'].includes(plan.lesson_type)) {
        return res.status(400).json({ message: "Imtihon kunlari /exam/submit orqali topshiriladi" });
      }
      const st = await examState(user._id, day, plan, items);
      if (!st.practice_items.length) return res.status(409).json({ message: "Hozir mini-mashq yo'q" });
      items = st.practice_items;
    }
    const item = items.find((i) => i.key === key);
    if (!item) return res.status(404).json({ message: 'Savol topilmadi' });

    const isTask = item.kind === 'write' || item.kind === 'speak'; // erkin topshiriq: xato hisoblanmaydi, "mastery"ga zarar yetkazmaydi
    let correct = ex.isCorrect(item, answer);
    // Bola bir xil so'z yoki shartda qotib qolmasin: TASK_LENIENT_AFTER marta urinib, kamida 3 so'z yozgan bo'lsa matn o'qituvchiga yuboriladi
    let lenient = false;
    if (isTask && !correct && day >= user.current_day) {
      const prev = await ExerciseProgress.findOne({ user: user._id, day_number: day, key }).lean();
      const wc = String(answer || '').trim().split(/\s+/).filter(Boolean).length;
      if (prev && (prev.attempts || 0) >= ex.TASK_LENIENT_AFTER && wc >= 3) { correct = true; lenient = true; }
    }
    const taskInfo = isTask && !correct ? ex.taskProblems(item, answer) : null;

    // Takrorlash rejimi (o'tgan kunlar): hech narsa saqlanmaydi
    if (day < user.current_day) {
      if (isTask) return res.status(200).json({ correct, review: true, ...(taskInfo ? { task: taskInfo } : {}) });
      if (!correct) await recordMistake(user._id, day, key); // xato "Mashq" bo'limiga avtomatik tushadi
      return res.status(200).json({
        correct,
        review: true,
        ...(correct ? {} : { reveal: ex.feedbackFor(item, ex.REVEAL_AFTER).reveal }),
      });
    }

    const filter = { user: user._id, day_number: day, key };
    const existing = await ExerciseProgress.findOne(filter).lean();

    if (existing && existing.status === 'done') {
      return res.status(200).json({ correct, already_done: true, progress: ex.summarize(items, await loadStates(user._id, day)) });
    }

    // upsert + unikal indeks: parallel birinchi javoblarda ikkinchisi E11000 beradi — bir marta qayta urinamiz
    const write = async (update, extraFilter = {}) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ExerciseProgress.updateOne({ ...filter, ...extraFilter }, update, { upsert: true });
        } catch (e) {
          if (!(e && e.code === 11000)) throw e;
          if (extraFilter.status) return { alreadyDone: true }; // done hujjat bor — filtr mos kelmadi
        }
      }
      return { alreadyDone: false };
    };

    if (isTask && !correct) {
      // Yetarli emas (qisqa yoki so'z ishlatilmagan): xato hisoblanmaydi, faqat urinish sanaladi
      await write({ $inc: { attempts: 1 }, $set: { last_activity_at: new Date() } });
      const tries = (existing ? existing.attempts || 0 : 0) + 1;
      return res.status(200).json({
        correct: false,
        task: { ...taskInfo, tries_left: Math.max(0, ex.TASK_LENIENT_AFTER - tries) },
        progress: ex.summarize(items, await loadStates(user._id, day)),
      });
    }

    let feedback = {};
    let wrongCount = existing ? existing.wrong : 0;
    if (correct) {
      const r = await write(
        {
          $set: {
            status: 'done', first_try: isTask ? true : !existing || existing.attempts === 0, done_at: new Date(), last_activity_at: new Date(),
            ...(isTask ? { answer_text: String(answer || '').slice(0, 1000), lenient } : {}),
          },
          $inc: { attempts: 1 },
        },
        { status: { $ne: 'done' } }
      );
      if (r && r.alreadyDone) feedback.already_done = true;
      else if (r && r.modifiedCount === 0 && r.upsertedCount === 0) feedback.already_done = true;
      else {
        const firstTry = isTask ? true : !existing || existing.attempts === 0;
        // Qayta o'tilayotgan mavzuda XP qayta berilmaydi (ataylab xato qilib XP yig'ib bo'lmasin)
        const replay = !!(await DayMastery.exists({ user: user._id, day_number: day, passes: { $gt: 0 } }));
        const rw = replay ? { xp: 0 } : await game.onExerciseDone(user._id, firstTry);
        feedback.reward = { xp: rw?.xp || 0 };
      }
    } else {
      await write({ $inc: { wrong: 1, attempts: 1 }, $set: { last_activity_at: new Date() } });
      await recordMistake(user._id, day, key); // xato "Mashq" bo'limiga avtomatik tushadi
      wrongCount += 1;
      feedback = ex.feedbackFor(item, wrongCount);
    }

    return res.status(200).json({
      correct,
      wrong_count: wrongCount,
      ...feedback,
      progress: ex.summarize(items, await loadStates(user._id, day)),
    });
  } catch (error) {
    console.error('answerExercise xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * GET /api/student/lesson/day/:day — o'tib bo'lingan kunni takrorlash (1 .. current_day-1).
 * Mashqlar javobsiz; javoblar POST /exercise/answer (review rejimi) orqali tekshiriladi.
 */
const getReviewLesson = async (req, res) => {
  try {
    const day = Number(req.params.day);
    if (!Number.isInteger(day) || day < 1 || day >= req.user.current_day) {
      return res.status(403).json({ message: "Faqat o'tib bo'lingan kunlarni takrorlash mumkin" });
    }
    const plan = await StudyPlan.findOne({ day_number: day });
    if (!plan || plan.needs_content) return res.status(404).json({ message: `${day}-kun darsi topilmadi` });

    const books = await booksForDay(plan);
    const items = await dayItems(plan, books);
    return res.status(200).json({
      day_number: plan.day_number,
      level: plan.level,
      unit_title: plan.unit_title,
      lesson_type: plan.lesson_type,
      review: true,
      vocabulary: plan.vocabulary,
      book_today: bookToday(books),
      book_sections: bookSections(books),
      exercises: items.map((it) => ex.publicItem(it)),
    });
  } catch (error) {
    console.error('getReviewLesson xatosi:', error);
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

    const items = ex.itemsFromPlan(plan);
    if (items.length === 0) {
      return res.status(409).json({ message: "Bu kun uchun imtihon savollari hali kiritilmagan" });
    }

    // Yiqilgan bo'lsa — avval mini-mashq
    const st = await examState(user._id, day, plan, items);
    if (st.phase === 'practice') {
      return res.status(409).json({
        code: 'practice_required',
        message: "Avval xato qilgan savollaringizni to'g'ri bajaring, keyin imtihonni qayta topshirasiz",
        practice: { exercises: exercisesPayload(st.practice_items, st.practice_states), progress: st.practice_progress },
        exam: examSummary(st, PASS_THRESHOLD_PERCENT),
      });
    }

    // Javoblar: yangi format answers:[{key, answer}] (tartib aralashgan), yoki eski quiz_answers/fill_answers (indeks bo'yicha)
    const given = new Map();
    if (Array.isArray(req.body.answers)) {
      for (const a of req.body.answers) if (a && typeof a.key === 'string') given.set(a.key, a.answer);
    } else {
      const quizAnswers = Array.isArray(req.body.quiz_answers) ? req.body.quiz_answers : [];
      const fillAnswers = Array.isArray(req.body.fill_answers) ? req.body.fill_answers : [];
      quizAnswers.forEach((a, i) => given.set(`q:${i}`, a));
      fillAnswers.forEach((a, i) => given.set(`f:${i}`, a));
    }

    const total = items.length;
    const wrongItems = items.filter((it) => !ex.isCorrect(it, given.get(it.key)));
    const correct = total - wrongItems.length;
    const scorePercent = Math.round((correct / total) * 100);
    const passed = scorePercent >= PASS_THRESHOLD_PERCENT;
    const attemptNumber = st.next_attempt_number;

    try {
      await ExamAttempt.create({
        user: user._id,
        study_plan_day: plan._id,
        day_number: day,
        lesson_type: plan.lesson_type,
        attempt_number: attemptNumber,
        correct_count: correct,
        total_count: total,
        wrong_keys: passed ? [] : wrongItems.map((it) => it.key),
        score_percent: scorePercent,
        passed,
      });
    } catch (e) {
      // Qo'sh bosish: shu urinish raqami allaqachon yozilgan (unikal indeks)
      if (e && e.code === 11000) {
        return res.status(409).json({ message: "Imtihon allaqachon topshirilgan. Yangilab qayta urinib ko'ring.", new_current_day: day });
      }
      throw e;
    }

    let newDay = day;
    let reward = null;
    if (passed) {
      const updated = await advanceDay(user._id, day);
      newDay = updated ? updated.current_day : (await User.findById(user._id)).current_day;
      if (updated) reward = await game.onExamPassed(user._id, scorePercent);
    }

    const bestPercent = Math.max(scorePercent, st.best_percent ?? 0);
    const body = {
      passed,
      score_percent: scorePercent,
      correct_count: correct,
      total_count: total,
      threshold_percent: PASS_THRESHOLD_PERCENT,
      attempt_number: attemptNumber,
      best_percent: bestPercent,
      first_attempt_percent: st.first_attempt_percent ?? scorePercent,
      new_current_day: newDay,
      reward,
      message: passed
        ? "Tabriklaymiz! Imtihondan o'tdingiz, keyingi kunga o'tdingiz."
        : `O'tish balli ${PASS_THRESHOLD_PERCENT}%. Xatolaringizni ko'rib chiqing, mini-mashqni bajaring va qayta topshiring.`,
    };
    if (!passed) {
      // Xato tahlili: faqat xato qilingan savollar va to'g'ri javoblari
      body.review = wrongItems.map((it) => ({
        key: it.key,
        kind: it.kind,
        question: it.question,
        options: it.options,
        your_answer: given.get(it.key) ?? null,
        correct: it.kind === 'mcq' ? { index: it.correct_index, text: it.options[it.correct_index] } : { word: it.correct_word },
      }));
      body.practice_required = true;
    }
    return res.status(200).json(body);
  } catch (error) {
    console.error('submitExamScore xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** Admin kartochkasi uchun: kunning savollari (to'g'ri javobi bilan) */
async function itemsForDay(day) {
  const plan = await StudyPlan.findOne({ day_number: day });
  if (!plan) return [];
  return dayItems(plan);
}

module.exports = { itemsForDay, getMe, getTodayLesson, getReviewLesson, getMyProgress, getLeaderboard, answerExercise, completeRegularLesson, submitExamScore, advanceDay, loadStates };
