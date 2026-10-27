/**
 * Kurs holatini birlashtirish (sof funksiyalar — bazasiz sinash mumkin).
 *
 * Holat (S): { u, d:{ [kunIdx]:{ c, s:{...}, t } }, ls:{...}, pts:{ ['d'+idx]:{date,c,r,b,p} }, name, me, gm, cert, lg }
 * Qoida: o'quvchi progressi hech qachon ORQAGA ketmaydi. Ikki qurilmadan kelgan holatlar birlashadi.
 */
const MAX_DAYS = 450;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(+x) ? +x : 0);

function mergeDay(a, b) {
  // a: serverdagi, b: telefondagi (yangisi)
  if (!isObj(a)) return b;
  if (!isObj(b)) return a;
  const aDone = !!a.c, bDone = !!b.c;
  if (aDone && !bDone) return { ...b, ...a, s: { ...(b.s || {}), ...(a.s || {}) } };
  const out = { ...a, ...b, s: { ...(a.s || {}), ...(b.s || {}) } };
  // eng yaxshi test natijasi qoladi
  if (a.t != null && b.t != null) out.t = Math.max(num(a.t), num(b.t));
  else if (a.t != null && b.t == null) out.t = a.t;
  return out;
}

/** Mock natijalari (S.mk): ikki qurilmadan kelganda ham hech narsa yo'qolmaydi */
function mergeMock(a, b) {
  const x = isObj(a) ? a : {}, y = isObj(b) ? b : {};
  const st = { ...(isObj(x.st) ? x.st : {}) };
  for (const [k, v] of Object.entries(isObj(y.st) ? y.st : {})) if (!st[k] || num(v && v.n) >= num(st[k].n)) st[k] = v;
  const byDate = (p, q, cap) => {
    const m = new Map();
    for (const e of [...(Array.isArray(p) ? p : []), ...(Array.isArray(q) ? q : [])]) if (isObj(e)) m.set(`${e.d}|${e.L}|${e.k || ''}`, e);
    return [...m.values()].sort((u, v) => num(u.d) - num(v.d)).slice(-cap);
  };
  const exam = { ...(isObj(x.exam) ? x.exam : {}) };
  for (const [k, v] of Object.entries(isObj(y.exam) ? y.exam : {})) exam[k] = Math.max(num(exam[k]), num(v));
  return {
    ...x, ...y,
    seen: { ...(isObj(x.seen) ? x.seen : {}), ...(isObj(y.seen) ? y.seen : {}) },
    st, exam,
    hist: byDate(x.hist, y.hist, 60),
    ex: byDate(x.ex, y.ex, 30),
  };
}

/** O'qituvchi uchun mock xulosa: urinishlar, o'rtacha, zaif mavzular (kamida 3 savol, <70%), daraja imtihonlari */
function mockSummary(state) {
  const k = isObj(state) && isObj(state.mk) ? state.mk : {};
  const hist = (Array.isArray(k.hist) ? k.hist : []).filter((h) => h && h.k !== 'bank');
  const last = hist.slice(-10);
  const weak = Object.entries(isObj(k.st) ? k.st : {})
    .filter(([, v]) => num(v && v.n) >= 3 && num(v.ok) / num(v.n) < 0.7)
    .map(([topic, v]) => ({ topic, n: num(v.n), percent: Math.round((num(v.ok) / num(v.n)) * 100) }))
    .sort((p, q) => p.percent - q.percent || q.n - p.n).slice(0, 8);
  return {
    seen: Object.keys(isObj(k.seen) ? k.seen : {}).length,
    attempts: hist.length,
    avg_last10: last.length ? Math.round(last.reduce((n, h) => n + num(h.p), 0) / last.length) : null,
    recent: last.map((h) => ({ at: num(h.d), kind: h.k, level: h.L, percent: num(h.p), questions: num(h.n) })),
    level_exams: isObj(k.exam) ? k.exam : {},
    multilevel: (Array.isArray(k.ex) ? k.ex : []).slice(-5).map((e) => ({ at: num(e.d), level: e.L, total: num(e.t), single: !!e.one })),
    weak_topics: weak,
    book_ticks: Object.keys(isObj(state && state.bk) ? state.bk : {}).length,
    phrases_learned: Object.keys(isObj(state && state.ph) ? state.ph : {}).length,
  };
}

function mergeState(server, client) {
  const a = isObj(server) ? server : {};
  const b = isObj(client) ? client : {};
  const out = { ...a, ...b };
  out.u = Math.max(num(a.u), num(b.u));
  const d = {};
  for (const k of new Set([...Object.keys(a.d || {}), ...Object.keys(b.d || {})])) {
    d[k] = mergeDay((a.d || {})[k], (b.d || {})[k]);
  }
  out.d = d;
  const pts = { ...(a.pts || {}) };
  for (const [k, v] of Object.entries(b.pts || {})) {
    if (!pts[k] || num(v && v.p) >= num(pts[k] && pts[k].p)) pts[k] = v;
  }
  out.pts = pts;
  out.ls = { ...(a.ls || {}), ...(b.ls || {}) };
  if (a.mk || b.mk) out.mk = mergeMock(a.mk, b.mk);
  if (a.bk || b.bk) out.bk = { ...(isObj(a.bk) ? a.bk : {}), ...(isObj(b.bk) ? b.bk : {}) };
  if (a.ph || b.ph) out.ph = { ...(isObj(a.ph) ? a.ph : {}), ...(isObj(b.ph) ? b.ph : {}) };
  return out;
}

/** 'YYYY-MM-DD' -> 'YYYY-Www' (ISO hafta) */
function weekKey(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = (t.getUTCDay() + 6) % 7; // Du=0
  t.setUTCDate(t.getUTCDate() - day + 3); // shu haftaning payshanbasi
  const y = t.getUTCFullYear();
  const first = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function summarize(state) {
  const s = isObj(state) ? state : {};
  const d = isObj(s.d) ? s.d : {};
  const done = Object.entries(d).filter(([, v]) => v && v.c);
  const week = {};
  let points = 0, last = '';
  for (const v of Object.values(isObj(s.pts) ? s.pts : {})) {
    const p = num(v && v.p);
    points += p;
    const wk = weekKey(v && v.date);
    if (wk) week[wk] = (week[wk] || 0) + p;
    if (v && v.date > last) last = v.date;
  }
  const tests = done.map(([k, v]) => [num(k), v.t]).filter(([, t]) => t != null).sort((x, y) => y[0] - x[0]).slice(0, 14).map(([, t]) => num(t));
  return {
    course_day: Math.min(MAX_DAYS, Math.max(0, Math.floor(num(s.u)) + 1)),
    days_done: done.length,
    points,
    accuracy: tests.length ? Math.round(tests.reduce((x, y) => x + y, 0) / tests.length) : null,
    week_points: week,
    last_study_date: last,
  };
}

/** 450 kunlik kurs: kun -> daraja (A1 1-90, A2 91-174, B1 175-264, B2 265-372, C1 373-450). Id'lar eski 5 daraja bilan bir xil. */
const LEVEL_BOUNDS = [[90, 'beginner'], [174, 'elementary'], [264, 'pre-intermediate'], [372, 'intermediate'], [450, 'upper-intermediate']];
function levelForCourseDay(day) {
  const d = Math.min(MAX_DAYS, Math.max(1, Math.floor(num(day)) || 1));
  return LEVEL_BOUNDS.find(([max]) => d <= max)[1];
}

module.exports = { levelForCourseDay, mergeMock, mockSummary, mergeState, mergeDay, summarize, weekKey, MAX_DAYS };
