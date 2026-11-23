/**
 * Kun testi (lug'at+grammatika) natijalarini birlashtirish. Hech qachon orqaga ketmaydi:
 *  res  : kalit bo'yicha eng yuqori ball, o'tgan bo'lsa o'tgan bo'lib qoladi
 *  prep : tayyorgarlik ko'rilgan kunlar (OR)
 *  done : qo'lda bajarilgan kunlar (OR)
 *  err  : xatolar daftari — mijozning oxirgisi (ikki marta to'g'ri javobdan keyin o'chadi, shuning uchun birlashtirilmaydi)
 */
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const KEY_RE = /^(v:\d{1,3}:[A-Za-z0-9]{1,3}|g:\d{1,3})$/;

function cleanRes(res) {
  const out = {};
  if (!isObj(res)) return out;
  for (const [k, v] of Object.entries(res)) {
    if (!KEY_RE.test(k) || !isObj(v)) continue;
    const best = Math.max(0, Math.min(100, Math.round(Number(v.best) || 0)));
    out[k] = { best, pass: !!v.pass && best >= 80 };
  }
  return out;
}
function cleanFlags(o) {
  const out = {};
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) if (/^\d{1,3}$/.test(k) && v) out[k] = true;
  return out;
}
function cleanErr(err) {
  const out = {};
  if (!isObj(err)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(err)) {
    if (++n > 600) break;
    if (!/^(g:[A-Za-z0-9_.-]{1,40}#\d{1,4}|[A-Za-z0-9:_.#-]{1,80})$/.test(k) || !isObj(v)) continue;
    out[k] = JSON.parse(JSON.stringify(v));
  }
  return out;
}

function mergeTests(cur, client) {
  const a = cleanRes(cur && cur.res), b = cleanRes(client && client.res);
  const res = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const o = res[k];
    res[k] = !o ? v : { best: Math.max(o.best, v.best), pass: o.pass || v.pass };
  }
  return {
    res,
    prep: { ...cleanFlags(cur && cur.prep), ...cleanFlags(client && client.prep) },
    done: { ...cleanFlags(cur && cur.done), ...cleanFlags(client && client.done) },
    err: client && client.err !== undefined ? cleanErr(client.err) : cleanErr(cur && cur.err),
  };
}
/** Admin uchun qisqa xulosa */
function summarizeTests(t) {
  const res = (t && t.res) || {};
  let v = 0, g = 0, last = 0;
  for (const [k, r] of Object.entries(res)) if (r.pass) { if (k[0] === 'v') v++; else g++; last = Math.max(last, Number(k.split(':')[1]) || 0); }
  return { vocab_passed: v, grammar_passed: g, last_day: last };
}
module.exports = { mergeTests, summarizeTests, cleanRes };
