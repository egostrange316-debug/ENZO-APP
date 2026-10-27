/**
 * 450 kunlik kurs (A1–C1): kun -> daraja, mavzu, kitob joyi. Sof funksiyalar — bazasiz sinash mumkin.
 * Ma'lumot: config/course450.json (ilovadagi kurs jadvalidan olingan).
 * Daraja id'lari eski 5 daraja bilan bir xil (User.level enum): beginner … upper-intermediate.
 */
const DAYS = require('../config/course450.json');

const TOTAL_DAYS = DAYS.length; // 450
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_ID = { A1: 'beginner', A2: 'elementary', B1: 'pre-intermediate', B2: 'intermediate', C1: 'upper-intermediate' };
const LEVEL_RANGES = {};
for (const row of DAYS) {
  const r = LEVEL_RANGES[row.l] || (LEVEL_RANGES[row.l] = { from: row.d, to: row.d });
  r.to = row.d;
}
// tk: day = oddiy kun, week = hafta oxiri, exam = daraja imtihoni
const TYPE_BY_TK = { day: 'regular', week: 'mini_check', exam: 'final_exam' };

const clampDay = (d) => Math.min(TOTAL_DAYS, Math.max(1, Math.floor(Number(d)) || 1));
const dayInfo = (d) => DAYS[clampDay(d) - 1];
const levelForDay = (d) => dayInfo(d).l;

/** Bitta kunning qisqa tavsifi: mavzu satri + kitob joyi */
function describeDay(d) {
  const x = dayInfo(d);
  const [a, b, lis] = x.bk || [];
  const pages = a ? (b && b !== a ? `${a}–${b}-bet` : `${a}-bet`) : null;
  return {
    day: x.d, level: x.l, type: TYPE_BY_TK[x.tk] || 'regular', week: x.w, week_title: x.wt,
    title: [x.g, x.v].filter(Boolean).join(' | ') || x.wt || null,
    grammar: x.g || null, vocab: x.v || null, reading: x.r || null, listening: x.a || null, writing: x.x || null,
    book_ref: pages ? `Kitob: ${pages}${lis ? `, Listening ${lis}-bet` : ''}` : null,
  };
}

// Mock mavzu kodi (G01, N01, A1-1 …) -> o'qiladigan nom, kurs jadvalidan
const TOPIC_NAMES = {};
for (const x of DAYS) for (const t of [x.g, x.v]) if (t) { const [code, ...rest] = t.split(' · '); if (!TOPIC_NAMES[code]) TOPIC_NAMES[code] = rest.join(' · ') || code; }
const topicTitle = (code) => (TOPIC_NAMES[code] ? `${code} · ${TOPIC_NAMES[code]}` : String(code));

/** O'quvchining joriy kuni: yangi tizimda course_day, eski yozuvlarda current_day. Kurs tugagan bo'lsa null. */
function studentDay(u) {
  const d = u.course_day > 0 ? u.course_day : u.current_day || 1;
  return d > TOTAL_DAYS ? null : d;
}

module.exports = { DAYS, TOTAL_DAYS, LEVELS, LEVEL_ID, LEVEL_RANGES, TYPE_BY_TK, clampDay, dayInfo, levelForDay, describeDay, studentDay, topicTitle };
