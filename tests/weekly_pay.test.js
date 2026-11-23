const test = require('node:test');
const assert = require('node:assert');
const { weeklyStats } = require('../lib/weeklyStats');
const D = require('../lib/dayStatus');
const { createBot } = require('../services/telegramBot');

const pts = (...dates) => ({ pts: Object.fromEntries(dates.map((d, i) => ['d' + i, { date: d, p: 10 }])) });
// 2026-11-22 = yakshanba
test('haftalik: 6 dars kunidan 5 tasi bajarilgan, dam kuni ham o\'qigan', () => {
  const state = pts('2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22');
  const w = weeklyStats({ group: null, state, today: '2026-11-22', joined: '2020-01-01' });
  assert.deepEqual({ l: w.lesson, d: w.done, e: w.extra, m: w.missed, p: w.points }, { l: 6, d: 5, e: 1, m: 1, p: 60 }); // 16-noyabr (dushanba) bajarilmagan
});
test('haftalik: sababli kun o\'tkazib yuborilgan emas; seriya hisobi', () => {
  const state = pts('2026-11-19', '2026-11-20', '2026-11-21');
  const w = weeklyStats({ group: null, state, excused_dates: ['2026-11-17', '2026-11-18'], today: '2026-11-22', joined: '2020-01-01' });
  assert.equal(w.excused, 2); assert.equal(w.missed, 1); assert.equal(w.streak, 3);
});
test('haftalik: yangi o\'quvchi ro\'yxatdan oldingi kunlar sanalmaydi', () => {
  const w = weeklyStats({ group: null, state: pts('2026-11-21'), today: '2026-11-22', joined: '2026-11-21' });
  assert.equal(w.lesson, 1); assert.equal(w.done, 1);
});

// ---- bot: to'lov eslatmasi ----
function mk(student, nowDate) {
  const sent = [], logs = new Set();
  const chain = (v) => ({ select() { return this; }, lean: async () => v });
  const deps = {
    token: 't', teacherIds: ['T1'],
    fetchFn: async (u, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ ok: true }) }; },
    User: { find: () => chain([student]) }, Group: { find: () => chain([]) }, CourseState: { find: () => chain([]) },
    NotifyLog: { create: async ({ key }) => { if (logs.has(key)) { const e = new Error('d'); e.code = 11000; throw e; } logs.add(key); }, deleteOne: async ({ key }) => logs.delete(key) },
    BotState: {},
  };
  return { bot: createBot(deps), sent };
}
const tk = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, h - 5));
const kid = (end) => ({ _id: 'a'.repeat(24), full_name: 'Ali Valiyev', group_name: null, parent_chats: ['100'], excused_dates: [], createdAt: '2020-01-01', subscription_end_date: end, monthly_fee: 300000, status: 'active' });

test('to\'lovga 3 kun qolganda ota-onaga xabar (summa bilan), qayta chaqirsa ikkinchi marta ketmaydi', async () => {
  const now = tk(2026, 11, 28, 12); // muddat 30-noyabr 23:00 -> 3 kun (yuqoriga yaxlitlanadi)
  const { bot, sent } = mk(kid(tk(2026, 11, 30, 23)), now);
  const r = await bot.runCheck(now);
  assert.equal(r.pay, 1);
  const txt = sent.find((x) => x.chat_id === '100' && /to[‘']lov/i.test(x.text)).text;
  assert.match(txt, /3 kun/); assert.match(txt, /300 000 so[‘']m/);
  assert.equal((await bot.runCheck(now)).pay, 0);
});
test('to\'lov kuni uzoq bo\'lsa xabar yo\'q; 10:00 dan oldin yo\'q', async () => {
  const far = tk(2026, 11, 16, 12);
  assert.equal((await mk(kid(tk(2026, 12, 31, 23)), far).bot.runCheck(far)).pay, 0);
  const early = tk(2026, 11, 28, 9);
  assert.equal((await mk(kid(tk(2026, 11, 30, 23)), early).bot.runCheck(early)).pay, 0);
});
test('muddat o\'tgach (grace) eslatma', async () => {
  const now = tk(2026, 12, 2, 12); // 30-noyabrdan 2 kun keyin -> grace_days_left 3? tekshiramiz: faqat 5/2/1 da yuboriladi
  const { bot, sent } = mk(kid(tk(2026, 11, 30, 23)), now);
  const r = await bot.runCheck(now);
  const info = require('../lib/subscription').subscriptionInfo(kid(tk(2026, 11, 30, 23)), now);
  assert.equal(r.pay, [5, 2, 1].includes(info.grace_days_left) ? 1 : 0);
  void sent;
});
test('yakshanba 19:00 dan keyin haftalik hisobot, bir marta', async () => {
  const now = tk(2026, 11, 22, 20);
  const { bot, sent } = mk(kid(null), now);
  const r = await bot.runCheck(now);
  assert.equal(r.weekly, 1);
  assert.match(sent.find((x) => /haftalik hisobot/i.test(x.text)).text, /Darslar: <b>0\/6<\/b>/);
  assert.equal((await bot.runCheck(now)).weekly, 0);
  const mon = tk(2026, 11, 23, 20);
  assert.equal((await mk(kid(null), mon).bot.runCheck(mon)).weekly, 0);
  void D;
});
