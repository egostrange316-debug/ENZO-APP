/**
 * Kurs tuzilmasi — bitta joyda.
 *
 * day_number GLOBAL: 1..400. Daraja (level) kun raqamidan hisoblanadi:
 *   1-100 elementary, 101-200 intermediate, 201-300 upper-intermediate, 301-400 advanced.
 *
 * Imtihon kunlari (ustuvorlik tartibi bilan):
 *   % 100 === 0 -> final_exam  (100, 200, 300, 400) — faqat Speaking, Admin tasdiqlaydi
 *   % 25  === 0 -> mid_check   (25, 50, 75, 125, ...)
 *   % 3   === 0 -> mini_check  (3, 6, 9, ...)
 *   qolgani     -> regular
 */
const LEVELS = ['elementary', 'intermediate', 'upper-intermediate', 'advanced'];
const DAYS_PER_LEVEL = 100;
const TOTAL_DAYS = LEVELS.length * DAYS_PER_LEVEL; // 400
const PASS_THRESHOLD_PERCENT = 70;
const SUBSCRIPTION_DAYS = 30;

function isValidDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= TOTAL_DAYS;
}

function levelForDay(day) {
  const idx = Math.min(LEVELS.length - 1, Math.floor((Math.max(1, day) - 1) / DAYS_PER_LEVEL));
  return LEVELS[idx];
}

function deriveLessonType(day) {
  if (day % 100 === 0) return 'final_exam';
  if (day % 25 === 0) return 'mid_check';
  if (day % 3 === 0) return 'mini_check';
  return 'regular';
}

module.exports = {
  LEVELS,
  DAYS_PER_LEVEL,
  TOTAL_DAYS,
  PASS_THRESHOLD_PERCENT,
  SUBSCRIPTION_DAYS,
  isValidDay,
  levelForDay,
  deriveLessonType,
};
