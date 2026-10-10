/**
 * Jadval/reyting uchun o'quvchilarning JORIY KUN bo'yicha progressi (ko'p o'quvchi uchun bir martada).
 *
 * kind:
 *   'regular'  — oddiy kun: percent = to'g'ri yakunlangan mashqlar / jami; first_try_percent; wrong_total
 *   'exam'     — mini_check/mid_check: urinishlar, birinchi urinish va eng yaxshi ball
 *   'final'    — final_exam (Speaking): faqat o'qituvchi tasdig'i kutiladi
 *   'finished' — kurs tugagan
 *   'no_plan'  — kun rejasi hali yaratilmagan
 */
const StudyPlan = require('../models/StudyPlan');
const BookMaterial = require('../models/BookMaterial');
const ExerciseProgress = require('../models/ExerciseProgress');
const ExamAttempt = require('../models/ExamAttempt');
const { buildDayItems } = require('./dayItemsService');
const ex = require('./exerciseService');
const { TOTAL_DAYS, deriveLessonType } = require('../config/curriculum');

/** @param users [{_id, current_day}] -> Map(String(userId) -> progress) */
async function dayProgressForUsers(users) {
  const result = new Map();
  const byDay = new Map();
  for (const u of users) {
    if (u.current_day > TOTAL_DAYS) {
      result.set(String(u._id), { kind: 'finished', day: u.current_day, percent: 100 });
      continue;
    }
    if (!byDay.has(u.current_day)) byDay.set(u.current_day, []);
    byDay.get(u.current_day).push(u);
  }

  for (const [day, group] of byDay) {
    const userIds = group.map((u) => u._id);
    const type = deriveLessonType(day);

    if (type === 'final_exam') {
      const approved = await ExamAttempt.find({ user: { $in: userIds }, day_number: day, speaking_approved_by_admin: true }).lean();
      const ok = new Set(approved.map((a) => String(a.user)));
      for (const u of group) {
        result.set(String(u._id), { kind: 'final', day, percent: 0, speaking_approved: ok.has(String(u._id)) });
      }
      continue;
    }

    if (type !== 'regular') {
      const attempts = await ExamAttempt.find({ user: { $in: userIds }, day_number: day, lesson_type: type })
        .sort({ attempt_number: 1 })
        .lean();
      const per = new Map();
      for (const a of attempts) {
        const k = String(a.user);
        if (!per.has(k)) per.set(k, []);
        per.get(k).push(a);
      }
      for (const u of group) {
        const list = per.get(String(u._id)) || [];
        const scores = list.map((a) => a.score_percent || 0);
        result.set(String(u._id), {
          kind: 'exam',
          day,
          lesson_type: type,
          percent: scores.length ? Math.max(...scores) : 0,
          attempts_count: list.length,
          first_attempt_percent: scores.length ? scores[0] : null,
          best_percent: scores.length ? Math.max(...scores) : null,
        });
      }
      continue;
    }

    const plan = await StudyPlan.findOne({ day_number: day }).lean();
    if (!plan) {
      for (const u of group) result.set(String(u._id), { kind: 'no_plan', day, percent: 0 });
      continue;
    }
    const books = await BookMaterial.find({ assigned_day: day, status: 'ready' }).lean();
    const items = await buildDayItems(plan, books);
    const keys = new Set(items.map((i) => i.key));

    const docs = await ExerciseProgress.find({ user: { $in: userIds }, day_number: day }).lean();
    const per = new Map();
    for (const d of docs) {
      if (!keys.has(d.key)) continue;
      const k = String(d.user);
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(d);
    }
    for (const u of group) {
      const s = ex.summarize(items, per.get(String(u._id)) || []);
      result.set(String(u._id), {
        kind: 'regular',
        day,
        percent: s.percent,
        first_try_percent: s.first_try_percent,
        wrong_total: s.wrong_total,
        done: s.done,
        total: s.total,
      });
    }
  }
  return result;
}

/** Kurs bo'yicha umumiy foiz: tugagan kunlar + joriy kun ulushi */
function courseProgressPercent(currentDay, dayPercent = 0) {
  const doneDays = Math.min(TOTAL_DAYS, Math.max(0, currentDay - 1));
  const frac = currentDay > TOTAL_DAYS ? 0 : (dayPercent || 0) / 100;
  return Math.min(100, Math.round(((doneDays + frac) / TOTAL_DAYS) * 1000) / 10);
}

module.exports = { dayProgressForUsers, courseProgressPercent };
