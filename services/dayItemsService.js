/**
 * Kunning hamma baholanadigan mashqlari (yagona manba):
 *   reja mashqlari + biriktirilgan kitoblar (lug'at, grammatika, reading, listening) + eski so'zlarni takrorlash.
 * Imtihon kunlarida faqat reja mashqlari.
 */
const StudyPlan = require('../models/StudyPlan');
const BookMaterial = require('../models/BookMaterial');
const ex = require('./exerciseService');

const REVIEW_LOOKBACK_DAYS = 30;

async function reviewPool(day) {
  const [plans, books] = await Promise.all([
    StudyPlan.find({ day_number: { $lt: day, $gte: Math.max(1, day - REVIEW_LOOKBACK_DAYS) } }).select('day_number vocabulary').lean(),
    BookMaterial.find({ assigned_day: { $lt: day, $gte: Math.max(1, day - REVIEW_LOOKBACK_DAYS) }, status: 'ready' })
      .select('assigned_day writing.vocabulary').lean(),
  ]);
  const pool = [];
  for (const p of plans) pool.push(...(p.vocabulary || []).map((v) => ({ ...v, _day: p.day_number })));
  for (const b of books) pool.push(...(b.writing?.vocabulary || []).map((v) => ({ ...v, _day: b.assigned_day })));
  return pool;
}

async function buildDayItems(plan, books) {
  const items = ex.itemsFromPlan(plan);
  if (plan.lesson_type !== 'regular') return items;
  const own = [];
  for (const b of books || []) {
    items.push(...ex.itemsFromBook(b));
    own.push(...(b.writing?.vocabulary || []).map((v) => v.word));
  }
  own.push(...(plan.vocabulary || []).map((v) => v.word));
  if (plan.day_number > 1) {
    const pool = await reviewPool(plan.day_number);
    items.push(...ex.reviewItems(plan.day_number, pool, own));
  }
  return items;
}

module.exports = { buildDayItems, reviewPool };
