/**
 * Kunlik vazifa holati (sof funksiyalar, bazasiz sinaladi). Barcha sanalar Toshkent vaqtida, 'YYYY-MM-DD'.
 *
 * "Vazifa bajarildi" = o'quvchi shu sanada kursning biror kunini TO'LIQ tugatgan (S.pts['d<idx>'].date === sana).
 * Holatlar:
 *  off      — bugun dars yo'q (dam olish kuni yoki ustoz "bugun dars yo'q" degan)
 *  done     — bugun bajardi
 *  excused  — sababli (ustoz yoki ota-ona tasdiqlagan)
 *  pending  — hali bajarmadi, muddat (soat) kelmagan
 *  missed   — muddat o'tdi, bajarmadi  → QIZIL
 */
const DAY_MS = 86400000;
const TZ_OFFSET_MS = 5 * 3600000;
const DEFAULT_LESSON_DAYS = [1, 2, 3, 4, 5, 6]; // Du=1 ... Ya=7; yakshanba dam
const DEFAULT_DEADLINE_HOUR = 20;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function tashkentNow(now = new Date()) {
  const t = new Date(now.getTime() + TZ_OFFSET_MS);
  const date = t.toISOString().slice(0, 10);
  return { date, hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}
function weekdayOf(dateStr) { // Du=1 ... Ya=7
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

function cleanLessonDays(v) {
  const a = Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort() : null;
  return a && a.length ? a : null;
}
function cleanDeadlineHour(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 8 && n <= 23 ? n : null;
}

/** Guruhning shu sanada darsi bormi? off_dates — "bugun dars yo'q", extra_dates — qo'shimcha dars */
function isLessonDay(group, dateStr) {
  const g = group || {};
  if ((g.off_dates || []).includes(dateStr)) return false;
  if ((g.extra_dates || []).includes(dateStr)) return true;
  return (cleanLessonDays(g.lesson_days) || DEFAULT_LESSON_DAYS).includes(weekdayOf(dateStr));
}

/** O'quvchi qaysi sanalarda kun tugatgan */
function completionDates(state) {
  const out = new Set();
  const pts = isObj(state) && isObj(state.pts) ? state.pts : {};
  for (const v of Object.values(pts)) if (isObj(v) && validDate(v.date)) out.add(v.date);
  return out;
}

/** Hozir bajarilayotgan (tugamagan) kunning bosqichlari soni */
function stepsInProgress(state) {
  const d = isObj(state) && isObj(state.d) ? state.d : {};
  let best = null;
  for (const [k, v] of Object.entries(d)) {
    if (!isObj(v) || v.c) continue;
    const n = isObj(v.s) ? Object.keys(v.s).length : 0;
    if (n > 0 && (best === null || Number(k) > best.k)) best = { k: Number(k), n };
  }
  return best ? best.n : 0;
}

/**
 * Bitta o'quvchining bugungi holati.
 *  opts: { group, state, excused_dates, today, hour, joined }  (joined — ro'yxatdan o'tgan sana)
 */
function studentStatus({ group, state, excused_dates, today, hour, joined }) {
  const dg = group && cleanDeadlineHour(group.deadline_hour) ? group.deadline_hour : DEFAULT_DEADLINE_HOUR;
  const done = completionDates(state);
  const excused = new Set(Array.isArray(excused_dates) ? excused_dates : []);
  const lessonToday = isLessonDay(group, today);

  let status;
  if (done.has(today)) status = 'done';
  else if (!lessonToday) status = 'off';
  else if (excused.has(today)) status = 'excused';
  else status = hour >= dg ? 'missed' : 'pending';

  // ketma-ket o'tkazib yuborilgan DARS kunlari (bugundan oldin; sababli kunlar uzmaydi, lekin sanalmaydi)
  let missedRow = 0;
  let cur = addDays(today, -1);
  for (let i = 0; i < 30; i++, cur = addDays(cur, -1)) {
    if (joined && cur < joined) break;
    if (!isLessonDay(group, cur) || excused.has(cur)) continue;
    if (done.has(cur)) break;
    missedRow++;
  }
  if (status === 'missed') missedRow++;
  return { status, deadline_hour: dg, missed_in_row: missedRow, steps_done: status === 'done' ? 0 : stepsInProgress(state), lesson_today: lessonToday };
}

const SEVERITY = { missed: 0, pending: 1, excused: 2, done: 3, off: 4 };
const sortStudents = (a, b) => (SEVERITY[a.status] - SEVERITY[b.status]) || (b.missed_in_row - a.missed_in_row) || a.full_name.localeCompare(b.full_name);

module.exports = {
  DEFAULT_LESSON_DAYS, DEFAULT_DEADLINE_HOUR, tashkentNow, weekdayOf, addDays, validDate,
  cleanLessonDays, cleanDeadlineHour, isLessonDay, completionDates, stepsInProgress, studentStatus, sortStudents,
};
