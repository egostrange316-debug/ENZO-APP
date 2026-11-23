/**
 * Kids 200 kun holatini birlashtirish (ilovadagi dvijok bilan bir xil qoida).
 * a = yangi yuborilgan (mahalliy), b = serverdagi. Tugatilgan kun hech qachon yo'qolmaydi.
 */
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const num = (x) => (Number.isFinite(+x) ? +x : 0);

function mergeKids(a, b) {
  a = obj(a); b = obj(b);
  const ap = obj(a.prog), bp = obj(b.prog);
  const prog = { ...bp, ...ap };
  for (const k of Object.keys(bp)) if (bp[k] && bp[k].done && !(ap[k] && ap[k].done)) prog[k] = bp[k];
  const log = { ...obj(b.log) };
  for (const [k, v] of Object.entries(obj(a.log))) log[k] = Math.max(num(v), num(log[k]));
  const ls = num(b.last) > num(a.last) ? b : a;
  const nw = num(b.ts) > num(a.ts) ? b : a;
  const r = { prog, log, stars: Math.max(num(a.stars), num(b.stars)), last: num(ls.last), streak: num(ls.streak), ts: Math.max(num(a.ts), num(b.ts)) };
  for (const k of ['name', 'srs', 'err', 'limit', 'unlockAll']) r[k] = nw[k] !== undefined ? nw[k] : (a[k] !== undefined ? a[k] : b[k]);
  return r;
}
function kidsSummary(s, start = 1) {
  const p = obj(s && s.prog);
  const isDone = (n) => !!(p[n] && p[n].done);
  let done = 0; for (let n = 1; n <= 200; n++) if (isDone(n)) done++;
  let day = 200; for (let n = Math.max(1, start); n <= 200; n++) if (!isDone(n)) { day = n; break; }
  return { done, day };
}
module.exports = { mergeKids, kidsSummary };
