const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, vocab, StudyPlan, User } = require('./helpers');
const G = require('../config/gamification');
const game = require('../services/gameService');

let t, s, admin;
before(async () => {
  t = await setup();
  admin = await t.makeAdmin();
  s = await t.makeStudent('Game Bola');
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(2) });
});
after(async () => { await t.teardown(); });

test('weekKey va dateKey barqaror', () => {
  assert.equal(game.weekKey(new Date('2026-10-05T10:00:00Z')), '2026-W41');
  assert.equal(game.weekKey(new Date('2026-10-11T10:00:00Z')), '2026-W41');
  assert.equal(game.weekKey(new Date('2026-10-12T10:00:00Z')), '2026-W42');
  assert.equal(game.dateKey(new Date('2026-10-09T20:00:00Z')), '2026-10-10'); // Toshkent UTC+5
});

test('savol birinchi urinishda to\'g\'ri -> +10 XP; qayta bosish XP bermaydi; kun yakunlansa +50 XP, streak 1', async () => {
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.status, 200);
  let xpSeen = 0;
  for (const it of lesson.data.exercises) {
    const full = (await StudyPlan.findOne({ day_number: 1 })).quizzes;
    const idx = Number(it.key.split(':')[1]);
    const r = await t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: 1, key: it.key, answer: full[idx].correct_answer_index } });
    assert.equal(r.data.correct, true);
    xpSeen += r.data.reward?.xp || 0;
    const again = await t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: 1, key: it.key, answer: full[idx].correct_answer_index } });
    assert.equal(again.data.reward, undefined);
  }
  assert.equal(xpSeen, 2 * G.XP.exercise_first_try);
  const done = await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } });
  assert.equal(done.status, 200);
  assert.equal(done.data.reward.xp, G.XP.day_complete);
  assert.equal(done.data.reward.streak, 1);
  assert.ok(done.data.reward.new_badges.some((b) => b.id === 'first_step'));
  const p = await t.call('GET', '/api/student/game/profile', { token: s.token });
  assert.equal(p.data.xp, 2 * G.XP.exercise_first_try + G.XP.day_complete);
  assert.equal(p.data.streak, 1);
  assert.equal(p.data.studied_today, true);
  assert.equal(p.data.week_xp, p.data.xp);
  assert.ok(p.data.coins >= 10); // nishon + XP tangalari
});

test('streak: ertasi kuni +1, bir kun tashlansa 1 ga tushadi, himoya saqlaydi', async () => {
  const u = await User.findOne({ full_name: 'Game Bola' });
  const day = (offset) => new Date(Date.now() + offset * 86400000);
  await User.updateOne({ _id: u._id }, { streak: 5, best_streak: 5, last_study_date: game.dateKey(day(-1)), streak_freezes: 0 });
  assert.equal((await game.touchStreak(u._id)).streak, 6);
  assert.equal((await game.touchStreak(u._id)).changed, false); // shu kuni ikkinchi marta
  await User.updateOne({ _id: u._id }, { streak: 6, last_study_date: game.dateKey(day(-3)), streak_freezes: 0 });
  assert.equal((await game.touchStreak(u._id)).streak, 1);
  await User.updateOne({ _id: u._id }, { streak: 6, last_study_date: game.dateKey(day(-2)), streak_freezes: 1 });
  const r = await game.touchStreak(u._id);
  assert.equal(r.streak, 7);
  assert.equal((await User.findById(u._id)).streak_freezes, 0);
  const prof = await game.profile(u._id);
  assert.ok(prof.best_streak >= 7);
});

test('o\'yin natijasi: XP kuniga cheklangan, soxta katta son kesiladi', async () => {
  const u = await User.findOne({ full_name: 'Game Bola' });
  await User.updateOne({ _id: u._id }, { xp: 0, week_xp: 0, game_xp_today: 0, game_xp_date: '' });
  const bad = await t.call('POST', '/api/student/game/result', { token: s.token, body: { game: 'nope', correct: 5, total: 5 } });
  assert.equal(bad.status, 400);
  const r1 = await t.call('POST', '/api/student/game/result', { token: s.token, body: { game: 'match', correct: 6, total: 6 } });
  assert.equal(r1.data.xp, 6 * G.XP.game_per_correct + G.XP.game_perfect_bonus);
  let total = r1.data.xp;
  for (let i = 0; i < 20; i++) {
    const r = await t.call('POST', '/api/student/game/result', { token: s.token, body: { game: 'speed', correct: 99999, total: 99999 } });
    total += r.data.xp;
  }
  assert.equal(total, G.XP.game_cap_per_day);
  const p = await t.call('GET', '/api/student/game/profile', { token: s.token });
  assert.equal(p.data.xp, G.XP.game_cap_per_day);
  assert.equal(p.data.game_xp_left_today, 0);
  assert.ok(p.data.badges.find((b) => b.id === 'gamer').earned);
});

test('do\'kon: tanga yetmasa 402, yetsa sotib oladi va kiyadi; ikki marta olib bo\'lmaydi; himoya sotiladi', async () => {
  const u = await User.findOne({ full_name: 'Game Bola' });
  await User.updateOne({ _id: u._id }, { coins: 10 });
  assert.equal((await t.call('POST', '/api/student/game/buy', { token: s.token, body: { item_id: 'av_dragon' } })).status, 402);
  assert.equal((await t.call('POST', '/api/student/game/buy', { token: s.token, body: { item_id: 'zzz' } })).status, 404);
  await User.updateOne({ _id: u._id }, { coins: 300 });
  const ok = await t.call('POST', '/api/student/game/buy', { token: s.token, body: { item_id: 'av_dragon' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.profile.coins, 300 - 150);
  assert.equal((await t.call('POST', '/api/student/game/buy', { token: s.token, body: { item_id: 'av_dragon' } })).status, 409);
  assert.equal((await t.call('POST', '/api/student/game/equip', { token: s.token, body: { item_id: 'av_robot' } })).status, 403);
  assert.equal((await t.call('POST', '/api/student/game/equip', { token: s.token, body: { item_id: 'av_dragon' } })).status, 200);
  const frz = await t.call('POST', '/api/student/game/buy', { token: s.token, body: { item_id: 'freeze' } });
  assert.equal(frz.data.profile.streak_freezes, 1);
  const shop = await t.call('GET', '/api/student/game/shop', { token: s.token });
  assert.ok(shop.data.items.find((i) => i.id === 'av_dragon').equipped);
});

test('haftalik reyting: faqat shu hafta XP si bor o\'quvchilar, tartib XP bo\'yicha, to\'lov ma\'lumoti yo\'q', async () => {
  const s2 = await t.makeStudent('Ikkinchi Bola');
  const u1 = await User.findOne({ full_name: 'Game Bola' });
  const u2 = await User.findOne({ full_name: 'Ikkinchi Bola' });
  await game.addXp(u1._id, 50);
  await game.addXp(u2._id, 500);
  const b = await t.call('GET', '/api/student/game/board', { token: s.token });
  assert.equal(b.status, 200);
  assert.equal(b.data.rows[0].name, 'Ikkinchi Bola');
  assert.ok(b.data.rows.find((r) => r.me));
  assert.ok(!JSON.stringify(b.data).match(/subscription|payment|paid/i));
  // eski hafta XP si yangi haftada 0 dan boshlanadi
  await User.updateOne({ _id: u2._id }, { week_key: '2020-W01', week_xp: 9999 });
  await game.addXp(u2._id, 10);
  assert.equal((await User.findById(u2._id)).week_xp, 10);
});

test('o\'yin so\'zlari: bugungi dars so\'zlari qaytadi', async () => {
  const w = await t.call('GET', '/api/student/game/words', { token: s.token });
  assert.equal(w.status, 200);
  assert.ok(Array.isArray(w.data.words));
});
