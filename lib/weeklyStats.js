/** Haftalik hisobot hisob-kitobi (sof funksiya). Sanalar Toshkent, 'YYYY-MM-DD'. Oxirgi 7 kun (bugun ham). */
const D = require('./dayStatus');
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function weeklyStats({ group, state, excused_dates, today, joined }) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(D.addDays(today, -i));
  const done = D.completionDates(state);
  const excused = new Set(excused_dates || []);
  let lesson = 0, doneLesson = 0, extra = 0, missed = 0, exc = 0;
  for (const d of days) {
    if (joined && d < joined) continue;
    const isL = D.isLessonDay(group, d);
    if (isL) {
      lesson++;
      if (done.has(d)) doneLesson++;
      else if (excused.has(d)) exc++;
      else missed++;
    } else if (done.has(d)) extra++;
  }
  let points = 0;
  const pts = isObj(state) && isObj(state.pts) ? state.pts : {};
  for (const v of Object.values(pts)) if (isObj(v) && days.includes(v.date)) points += Number(v.p) || 0;
  // joriy seriya: oxirgi dars kunlaridan ketma-ket bajarilganlar
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = D.addDays(today, -i);
    if (joined && d < joined) break;
    if (done.has(d)) { streak++; continue; }
    if (!D.isLessonDay(group, d) || excused.has(d) || i === 0) continue; // bugun hali tugamagan bo'lishi mumkin
    break;
  }
  return { lesson, done: doneLesson, extra, missed, excused: exc, points, streak };
}
module.exports = { weeklyStats };
