/**
 * Kurs tuzilmasi — bitta joyda.
 *
 * day_number GLOBAL: 1..646. Daraja kun raqamidan hisoblanadi. Darajalar uzunligi har xil:
 *
 *   beginner           EVIU 1-30-unit        70 kun   (1-70)      30 unit x 2 kun + 10 imtihon
 *   elementary         EVIU 31-60-unit       70 kun   (71-140)    30 unit x 2 kun + 10 imtihon
 *   pre-intermediate   Key Words (Pre-Int)  154 kun   (141-294)   132 bet + 22 bo'lim imtihoni
 *   intermediate       Key Words (Int)      170 kun   (295-464)   148 bet + 22 bo'lim imtihoni
 *   upper-intermediate Key Words (Upper)    182 kun   (465-646)   156 bet + 26 imtihon (har 6 darsdan keyin)
 *
 * Imtihon kunlari:
 *   - Pre-Intermediate va Intermediate: har bo'lim (kitob "section") tugagach.
 *   - Boshqa darajalar: har 6 ta darsdan keyin.
 *   - Darajaning OXIRGI kuni = final_exam (faqat Speaking, o'qituvchi tasdiqlaydi).
 *   - Qolgan imtihonlardan har 4-chisi (oxirgisidan tashqari) = mid_check, boshqalari = mini_check.
 */
const LEVELS = ['beginner', 'elementary', 'pre-intermediate', 'intermediate', 'upper-intermediate'];

// Darslar guruhi o'lchamlari (har guruhdan keyin 1 imtihon kuni).
const every = (lessons, size) => Array.from({ length: lessons / size }, () => size);
const SECTION_SIZES = {
  beginner: every(60, 6),
  elementary: every(60, 6),
  'pre-intermediate': every(132, 6),
  intermediate: [5, 5, 7, 7, 7, 5, 5, 9, 9, 5, 5, 7, 7, 7, 11, 9, 5, 7, 9, 5, 7, 5],
  'upper-intermediate': every(156, 6),
};

const LEVEL_LABELS = {
  beginner: 'Beginner',
  elementary: 'Elementary',
  'pre-intermediate': 'Pre-Intermediate',
  intermediate: 'Intermediate',
  'upper-intermediate': 'Upper-Intermediate',
};

// Har daraja uchun kun oraliqlari va imtihon turlarini oldindan hisoblaymiz.
const LEVEL_RANGES = {};
const DAY_TYPES = [null]; // DAY_TYPES[day] = lesson_type
let cursor = 1;
for (const level of LEVELS) {
  const sizes = SECTION_SIZES[level];
  const from = cursor;
  sizes.forEach((size, i) => {
    for (let k = 0; k < size; k++) DAY_TYPES[cursor++] = 'regular';
    const last = i === sizes.length - 1;
    DAY_TYPES[cursor++] = last ? 'final_exam' : (i + 1) % 4 === 0 ? 'mid_check' : 'mini_check';
  });
  LEVEL_RANGES[level] = { from, to: cursor - 1, days: cursor - from, lessons: sizes.reduce((a, b) => a + b, 0), exams: sizes.length };
}

const TOTAL_DAYS = cursor - 1; // 646
const PASS_THRESHOLD_PERCENT = 80; // hamma joyda 80% (kun testi, mock, daraja imtihoni)
// Mavzuni o'zlashtirish: birinchi urinishda to'g'ri javoblar ulushi shundan past bo'lsa mavzu qayta o'tiladi.
const MASTERY_THRESHOLD_PERCENT = Number(process.env.MASTERY_THRESHOLD_PERCENT) || 80;
// Shuncha marta qaytarilsa o'qituvchiga belgi tushadi (bola baribir o'tmaydi, o'qituvchi qo'lda o'tkaza oladi).
const MASTERY_TEACHER_AFTER = 3;
const SUBSCRIPTION_DAYS = 30;

function isValidDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= TOTAL_DAYS;
}

function levelForDay(day) {
  const d = Math.min(TOTAL_DAYS, Math.max(1, day));
  return LEVELS.find((l) => d <= LEVEL_RANGES[l].to);
}

function deriveLessonType(day) {
  return DAY_TYPES[day] || 'regular';
}

/** Darajaning kun oralig'i { from, to, days, lessons, exams }. */
function levelRange(level) {
  return LEVEL_RANGES[level] || null;
}

/** Darajadagi barcha oddiy (dars) kunlari raqamlari. */
function regularDaysOfLevel(level) {
  const r = LEVEL_RANGES[level];
  if (!r) return [];
  const days = [];
  for (let d = r.from; d <= r.to; d++) if (DAY_TYPES[d] === 'regular') days.push(d);
  return days;
}

/** Imtihon kunidan oldingi darslar (shu imtihon qaysi kunlarni qamrab oladi). */
function examCoverage(day) {
  if (!isValidDay(day) || DAY_TYPES[day] === 'regular') return [];
  const out = [];
  for (let d = day - 1; d >= 1 && DAY_TYPES[d] === 'regular'; d--) out.unshift(d);
  return out;
}

module.exports = {
  LEVELS,
  LEVEL_LABELS,
  LEVEL_RANGES,
  SECTION_SIZES,
  TOTAL_DAYS,
  PASS_THRESHOLD_PERCENT,
  MASTERY_THRESHOLD_PERCENT,
  MASTERY_TEACHER_AFTER,
  SUBSCRIPTION_DAYS,
  isValidDay,
  levelForDay,
  deriveLessonType,
  levelRange,
  regularDaysOfLevel,
  examCoverage,
};
