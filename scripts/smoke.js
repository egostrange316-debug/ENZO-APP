// Server tekshiruvi (o'zgartirmaydi, faqat o'qiydi). cmd:
//   set SERVER=https://SIZNING-SERVER.onrender.com
//   set ADMIN_NAME=Enzo Academy
//   set ADMIN_PASSWORD=...        (faqat shu oynada, hech qayerga yozmang)
//   node scripts/smoke.js
const S = (process.env.SERVER || '').replace(/\/$/, '');
const { ADMIN_NAME: name, ADMIN_PASSWORD: password } = process.env;
if (!S) { console.error('SERVER kerak'); process.exit(1); }
let bad = 0;
const ok = (t, c, extra = '') => { console.log(c ? '  ✔' : '  ✖', t, extra); if (!c) bad++; };
const j = async (path, opt = {}, token) => {
  const r = await fetch(S + path, { ...opt, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  let b = null; try { b = await r.json(); } catch (e) { /* json emas */ }
  return { s: r.status, b };
};
(async () => {
  console.log('Server uyg\'onishi kutilmoqda (50 soniyagacha)...');
  const h = await j('/'); ok('Server javob beradi', h.s === 200, h.b && h.b.message);
  const w = await fetch(S + '/api/telegram/webhook', { method: 'POST' }); ok('Telegram webhook maxfiy kalitsiz yopiq (403)', w.status === 403, w.status);
  const c = await fetch(S + '/api/telegram/cron?key=xato'); ok('Telegram cron kalitsiz yopiq (403)', c.status === 403, c.status);
  const g = await j('/api/auth/groups'); ok('Guruhlar ro\'yxati', g.s === 200 && Array.isArray(g.b && g.b.groups), (g.b && g.b.groups || []).length + ' ta');
  const nolog = await j('/api/admin/status'); ok('Admin yo\'li loginsiz yopiq', nolog.s === 401 || nolog.s === 403, nolog.s);
  if (name && password) {
    const l = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ full_name: name, password }) });
    const t = l.b && (l.b.token || (l.b.data && l.b.data.token));
    ok('Admin kirishi', l.s === 200 && !!t, l.s);
    if (t) {
      const st = await j('/api/admin/status', {}, t); ok('Qizil jadval (/status)', st.s === 200 && Array.isArray(st.b && st.b.groups), st.b && `${st.b.groups.length} guruh, qizil: ${st.b.total.missed}`);
      const pay = await j('/api/admin/payments', {}, t); ok('To\'lovlar jadvali', pay.s === 200 && Array.isArray(pay.b && pay.b.rows), pay.b && pay.b.rows && `${pay.b.rows.length} o'quvchi`);
      const gr = await j('/api/admin/groups', {}, t); ok('Guruhlar (admin)', gr.s === 200, gr.s);
    }
  } else console.log('  (ADMIN_NAME/ADMIN_PASSWORD berilmadi — admin tekshiruvlari o\'tkazib yuborildi)');
  console.log(bad ? `\n${bad} ta muammo bor` : '\nHammasi yaxshi');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
