const test = require('node:test');
const assert = require('node:assert');
const { createBot } = require('../services/telegramBot');
const D = require('../lib/dayStatus');
const X = require('../lib/botText');
const { makeRouter } = require('../routes/telegramRoutes');

const today = D.tashkentNow().date;
const mkId = (c) => c.repeat(24);

function world({ students, pts = {}, groups = [] }) {
  const sent = [];
  const logs = new Set();
  const states = new Map();
  const wrapDoc = (u) => Object.assign(u, { save: async () => {} });
  const chain = (v) => ({ select() { return this; }, lean: async () => v, then: (a, b) => Promise.resolve(v).then(a, b) });
  const match = (q) => (u) => Object.entries(q).every(([k, v]) => {
    if (k === 'status') return true;
    if (k === 'parent_chats') return (u.parent_chats || []).includes(v);
    if (k === '_id') return String(u._id) === String(v);
    return u[k] === v || k === 'role';
  });
  const deps = {
    token: 't', teacherIds: ['T1'],
    fetchFn: async (url, opt) => { sent.push({ m: url.split('/').pop(), ...JSON.parse(opt.body) }); return { json: async () => ({ ok: true }) }; },
    User: {
      find: (q) => chain(students.filter(match(q || {}))),
      findOne: (q) => { const u = students.find(match(q)); return { select() { return this; }, lean: async () => u, then: (a, b) => Promise.resolve(u ? wrapDoc(u) : null).then(a, b) }; },
      updateMany: async (q, upd) => { for (const u of students.filter(match(q))) u.parent_chats = u.parent_chats.filter((c) => c !== upd.$pull.parent_chats); },
    },
    Group: { find: () => chain(groups), findOne: () => chain(groups[0] || null) },
    CourseState: { find: () => chain(Object.entries(pts).map(([user, state]) => ({ user, state }))), findOne: (q) => chain(pts[String(q.user)] ? { state: pts[String(q.user)] } : null) },
    NotifyLog: { create: async ({ key }) => { if (logs.has(key)) { const e = new Error('dup'); e.code = 11000; throw e; } logs.add(key); }, deleteOne: async ({ key }) => { logs.delete(key); } },
    BotState: {
      findOneAndUpdate: async (q, u) => { states.set(q.chat_id, { ...(states.get(q.chat_id) || {}), ...u, chat_id: q.chat_id }); },
      findOne: (q) => chain(states.get(q.chat_id) || null), updateOne: async (q, u) => { states.set(q.chat_id, { ...states.get(q.chat_id), ...u }); }, deleteOne: async (q) => { states.delete(q.chat_id); },
    },
  };
  return { deps, sent, logs };
}
const kid = (id, name, extra = {}) => ({ _id: id, role: 'student', full_name: name, group_name: 'B1-2', parent_chats: [], excused_dates: [], pay_day: 5, createdAt: '2020-01-01', status: 'active', ...extra });
const msg = (chat, text) => ({ message: { chat: { id: chat, type: 'private' }, text, from: { first_name: 'Otasi' } } });
const cb = (chat, data) => ({ callback_query: { id: 'q', data, from: { id: chat, first_name: 'Ota' }, message: { chat: { id: chat } } } });
const texts = (sent, to) => sent.filter((x) => x.m === 'sendMessage' && String(x.chat_id) === to).map((x) => x.text);

test('ota-ona: /start -> ism -> tugma -> ulanadi, ustozga xabar ketadi', async () => {
  const A = kid(mkId('a'), 'Ali Valiyev');
  const w = world({ students: [A, kid(mkId('b'), 'Dilnoza Karimova')] });
  const bot = createBot(w.deps);
  await bot.handleUpdate(msg(100, '/start'));
  await bot.handleUpdate(msg(100, 'ali valiyev'));
  const pick = w.sent.filter((x) => x.reply_markup).pop();
  assert.match(pick.reply_markup.inline_keyboard[0][0].text, /Ali Valiyev · B1-2 · to'lov: 5-sana/);
  await bot.handleUpdate(cb(100, pick.reply_markup.inline_keyboard[0][0].callback_data));
  assert.deepEqual(A.parent_chats, ['100']);
  assert.ok(texts(w.sent, '100').some((t) => /Ulandi/.test(t)));
  assert.ok(texts(w.sent, 'T1').some((t) => /Yangi ulanish/.test(t)));
});
test('ism topilmasa: 3 urinishdan keyin ustozga xabar', async () => {
  const w = world({ students: [kid(mkId('a'), 'Ali Valiyev')] });
  const bot = createBot(w.deps);
  await bot.handleUpdate(msg(5, '/start'));
  for (let i = 0; i < 3; i++) await bot.handleUpdate(msg(5, 'Nomalum Odam'));
  assert.ok(texts(w.sent, 'T1').some((t) => /3 urinish/.test(t)));
});
test('guruhda (private emas) javob bermaydi', async () => {
  const w = world({ students: [] });
  await createBot(w.deps).handleUpdate({ message: { chat: { id: 9, type: 'group' }, text: '/start' } });
  assert.equal(w.sent.length, 0);
});
test('3 tadan ortiq ota-ona ulanmaydi', async () => {
  const A = kid(mkId('a'), 'Ali Valiyev', { parent_chats: ['1', '2', '3'] });
  const w = world({ students: [A] });
  await createBot(w.deps).handleUpdate(cb(7, `link:${A._id}`));
  assert.deepEqual(A.parent_chats, ['1', '2', '3']);
});

test('runCheck: bajarmagan -> ota-onaga va ustozga; bajargan -> "bajardi"; ikki marta ketmaydi', async () => {
  const hour = D.tashkentNow().hour;
  const A = kid(mkId('a'), 'Ali Valiyev', { parent_chats: ['100'] });
  const B = kid(mkId('b'), 'Dilnoza Karimova', { parent_chats: ['200'] });
  const w = world({
    students: [A, B], groups: [{ name: 'B1-2', deadline_hour: 8, lesson_days: [1, 2, 3, 4, 5, 6, 7] }],
    pts: { [A._id]: { pts: { d1: { date: today, p: 5 } } } },
  });
  const bot = createBot(w.deps);
  const r1 = await bot.runCheck();
  if (hour < 8) return assert.deepEqual(r1, { done: 0, missed: 0, digest: 0, risk: 0, pay: 0, weekly: 0 }); // tun: hech narsa yubormaydi
  assert.equal(r1.done, 1); assert.equal(r1.missed, 1); assert.equal(r1.digest, 1);
  assert.ok(texts(w.sent, '100')[0].includes('bajardi'));
  assert.ok(texts(w.sent, '200')[0].includes('dars qilmadi'));
  assert.ok(texts(w.sent, 'T1')[0].includes('Dilnoza Karimova'));
  const n = w.sent.length;
  const r2 = await bot.runCheck();
  assert.deepEqual(r2, { done: 0, missed: 0, digest: 0, risk: 0, pay: 0, weekly: 0 });
  assert.equal(w.sent.length, n);
});
test('runCheck: dam kuni/dars yo\'q kunida ogohlantirish yo\'q', async () => {
  const B = kid(mkId('b'), 'Dilnoza Karimova', { parent_chats: ['200'] });
  const w = world({ students: [B], groups: [{ name: 'B1-2', deadline_hour: 8, off_dates: [today] }] });
  const r = await createBot(w.deps).runCheck();
  assert.equal(r.missed, 0); assert.equal(w.sent.length, 0);
});
test('Telegram yuborolmasa kalit o\'chadi va keyingi safar qayta uriniladi', async () => {
  if (D.tashkentNow().hour < 8) return;
  const B = kid(mkId('b'), 'Dilnoza', { parent_chats: ['200'] });
  const w = world({ students: [B], groups: [{ name: 'B1-2', deadline_hour: 8, lesson_days: [1, 2, 3, 4, 5, 6, 7] }] });
  let fail = true;
  const f = w.deps.fetchFn;
  w.deps.fetchFn = async (u, o) => (fail && JSON.parse(o.body).chat_id === '200' ? { json: async () => ({ ok: false }) } : f(u, o));
  const bot = createBot(w.deps);
  assert.equal((await bot.runCheck()).missed, 0);
  fail = false;
  assert.equal((await bot.runCheck()).missed, 1);
});
test('ota-ona "Sababli" -> ustozga; ustoz tasdiqlasa excused_dates ga yoziladi va ota-onaga aytiladi', async () => {
  const A = kid(mkId('a'), 'Ali Valiyev', { parent_chats: ['100'] });
  const w = world({ students: [A] });
  const bot = createBot(w.deps);
  await bot.handleUpdate(cb(100, `excuse:${A._id}:${today}`));
  assert.ok(texts(w.sent, 'T1').some((t) => /Tasdiq kerak/.test(t)));
  await bot.handleUpdate(cb(999, `confirm:${A._id}:${today}`)); // ustoz emas
  assert.deepEqual(A.excused_dates, []);
  await bot.handleUpdate(cb('T1', `confirm:${A._id}:${today}`));
  assert.deepEqual(A.excused_dates, [today]);
  assert.ok(texts(w.sent, '100').some((t) => /sababli deb tasdiqlandi/.test(t)));
});
test('/uzish ota-onani ajratadi', async () => {
  const A = kid(mkId('a'), 'Ali', { parent_chats: ['100'] });
  const w = world({ students: [A] });
  await createBot(w.deps).handleUpdate(msg(100, '/uzish'));
  assert.deepEqual(A.parent_chats, []);
});
test('ism qidirish: apostrof va harf farqi', () => {
  assert.equal(X.matchStudents('oktam karimov', [{ full_name: "O'ktam Karimov" }]).length, 1);
  assert.equal(X.matchStudents('al', [{ full_name: 'Ali' }]).length, 0);
  assert.equal(X.esc('<b>&'), '&lt;b&gt;&amp;');
});
test('webhook: maxfiy kalitsiz 403, kalit bilan 200 va yangilanish botga beriladi', async () => {
  const got = [];
  const router = makeRouter({ handleUpdate: (u) => got.push(u), runCheck: async () => ({ ok: 1 }) }, { TELEGRAM_WEBHOOK_SECRET: 'sirsirsir', CRON_SECRET: 'cron123' });
  const call = (path, headers, query = {}) => new Promise((resolve) => {
    const res = { sendStatus: (c) => resolve({ c }), status: (c) => ({ json: (b) => resolve({ c, b }) }) };
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    layer.route.stack[0].handle({ get: (h) => headers[h], body: { update_id: 1 }, query }, res);
  });
  assert.equal((await call('/webhook', {})).c, 403);
  assert.equal((await call('/webhook', { 'x-telegram-bot-api-secret-token': 'xato' })).c, 403);
  assert.equal((await call('/webhook', { 'x-telegram-bot-api-secret-token': 'sirsirsir' })).c, 200);
  assert.equal(got.length, 1);
  assert.equal((await call('/cron', {}, { key: 'yoq' })).c, 403);
  assert.equal((await call('/cron', {}, { key: 'cron123' })).c, 200);
});
