/**
 * O'yin tizimi mantig'i: XP, tanga, streak, nishonlar, ligalar, haftalik reyting, do'kon, o'yin natijalari.
 * Hamma o'zgarish ATOMIK ($inc) — qo'sh bosish yoki ikki qurilma XP'ni ikki marta bermaydi (chaqiruvchi tomon
 * har hodisa uchun faqat bir marta chaqirishi kerak: masalan savol 'done' bo'lgan paytda).
 */
const User = require('../models/User');
const G = require('../config/gamification');
const { LEVELS, TOTAL_DAYS } = require('../config/curriculum');

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // Toshkent UTC+5

const dateKey = (d = new Date()) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function weekKey(d = new Date()) {
  const t = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = (t.getUTCDay() + 6) % 7; // dushanba = 0
  t.setUTCDate(t.getUTCDate() - day + 3); // shu haftaning payshanbasi
  const y = t.getUTCFullYear();
  const week1 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function xpLevel(xp) {
  let lvl = 1;
  for (let i = 0; i < G.XP_LEVELS.length; i++) if (xp >= G.XP_LEVELS[i]) lvl = i + 1;
  const cur = G.XP_LEVELS[lvl - 1];
  const next = G.XP_LEVELS[lvl] ?? null;
  return { level: lvl, xp_in_level: xp - cur, xp_for_next: next === null ? null : next - cur };
}
function leagueFor(xp) {
  let l = G.LEAGUES[0];
  for (const x of G.LEAGUES) if (xp >= x.min_xp) l = x;
  return l;
}

/** Streak'ni yangilaydi (kuniga bir marta). Qaytaradi: yangi streak + bonus tanga. */
async function touchStreak(userId, now = new Date()) {
  const today = dateKey(now);
  const u = await User.findById(userId).select('streak best_streak last_study_date streak_freezes').lean();
  if (!u || u.last_study_date === today) return { streak: u?.streak || 0, bonus_coins: 0, changed: false };
  let streak = 1;
  let freezes = u.streak_freezes || 0;
  if (u.last_study_date) {
    const gap = dayDiff(u.last_study_date, today);
    if (gap === 1) streak = u.streak + 1;
    else if (gap > 1) {
      const missed = gap - 1;
      if (missed <= freezes && u.streak > 0) { freezes -= missed; streak = u.streak + 1; } // himoya sarflandi
    }
  }
  const bonus = G.STREAK_MILESTONES[streak] || 0;
  const r = await User.updateOne(
    { _id: userId, last_study_date: { $ne: today } },
    { $set: { streak, last_study_date: today, streak_freezes: freezes }, $max: { best_streak: streak }, $inc: { coins: bonus } }
  );
  return { streak, bonus_coins: r.modifiedCount ? bonus : 0, changed: !!r.modifiedCount };
}

/** XP + tanga qo'shadi (haftalik XP shu hafta uchun). */
async function addXp(userId, amount, now = new Date()) {
  if (!(amount > 0)) return null;
  const wk = weekKey(now);
  const coins = Math.floor(amount * G.COINS_PER_XP);
  // Shu hafta bo'lsa haftalik XP ga qo'shamiz; bo'lmasa (yangi hafta) 0 dan boshlaymiz. Ikkalasi ham atomik.
  const same = await User.updateOne({ _id: userId, week_key: wk }, { $inc: { week_xp: amount, xp: amount, coins } });
  if (!same.matchedCount) {
    const fresh = await User.updateOne({ _id: userId, week_key: { $ne: wk } }, { $set: { week_key: wk, week_xp: amount }, $inc: { xp: amount, coins } });
    if (!fresh.matchedCount) await User.updateOne({ _id: userId }, { $inc: { week_xp: amount, xp: amount, coins } }); // poyga: boshqa so'rov hafta kalitini o'rnatib bo'lgan
  }
  return { xp: amount, coins };
}

function statsFor(u) {
  const levelsDone = Math.max(0, LEVELS.indexOf(u.level));
  return {
    days_done: u.days_done || 0,
    streak: Math.max(u.streak || 0, u.best_streak || 0),
    words: (u.words_count || 0),
    exams_passed: u.exams_passed || 0,
    perfect_exams: u.perfect_exams || 0,
    games_played: u.games_played || 0,
    xp: u.xp || 0,
    levels_done: levelsDone,
  };
}

/** Yangi ochilgan nishonlarni beradi. Qaytaradi: yangi nishonlar ro'yxati. */
async function checkBadges(userId) {
  const u = await User.findById(userId).lean();
  if (!u) return [];
  const have = new Set((u.badges || []).map((b) => b.id));
  const stats = statsFor(u);
  const fresh = G.BADGES.filter((b) => !have.has(b.id) && Object.entries(b.cond).every(([k, v]) => (stats[k] || 0) >= v));
  const got = [];
  for (const b of fresh) {
    const r = await User.updateOne({ _id: userId, 'badges.id': { $ne: b.id } }, { $push: { badges: { id: b.id, at: new Date() } }, $inc: { coins: 10 } });
    if (r.modifiedCount) got.push({ id: b.id, name_uz: b.name_uz, icon: b.icon, desc_uz: b.desc_uz });
  }
  return got;
}

/** Savol birinchi marta 'done' bo'lganda. */
async function onExerciseDone(userId, firstTry) {
  const r = await addXp(userId, firstTry ? G.XP.exercise_first_try : G.XP.exercise_retry);
  return { ...r, new_badges: [] };
}

/** Kun yakunlanganda (regular). */
async function onDayComplete(userId, { wordsLearned = 0 } = {}) {
  await User.updateOne({ _id: userId }, { $inc: { days_done: 1, words_count: wordsLearned } });
  const st = await touchStreak(userId);
  await addXp(userId, G.XP.day_complete);
  const badges = await checkBadges(userId);
  return { xp: G.XP.day_complete, streak: st.streak, bonus_coins: st.bonus_coins, new_badges: badges };
}

/** Imtihondan o'tganda. */
async function onExamPassed(userId, scorePercent) {
  const perfect = scorePercent >= 100;
  await User.updateOne({ _id: userId }, { $inc: { exams_passed: 1, perfect_exams: perfect ? 1 : 0 } });
  const st = await touchStreak(userId);
  const xp = G.XP.exam_pass + (perfect ? G.XP.exam_perfect_bonus : 0);
  await addXp(userId, xp);
  const badges = await checkBadges(userId);
  return { xp, streak: st.streak, new_badges: badges };
}

/** O'yin natijasi: server XP ni cheklaydi (kuniga G.XP.game_cap_per_day). */
async function onGameResult(userId, { game, correct, total }) {
  const def = G.GAMES.find((g) => g.id === game);
  if (!def) return { error: "Noma'lum o'yin" };
  const t = Math.max(1, Math.min(60, Math.floor(Number(total) || 0)));
  const c = Math.max(0, Math.min(t, Math.floor(Number(correct) || 0)));
  const today = dateKey();
  let xp = c * G.XP.game_per_correct + (c === t && t >= 5 ? G.XP.game_perfect_bonus : 0);
  const u = await User.findById(userId).select('game_xp_date game_xp_today').lean();
  const used = u.game_xp_date === today ? u.game_xp_today : 0;
  xp = Math.max(0, Math.min(xp, G.XP.game_cap_per_day - used));
  await User.updateOne(
    { _id: userId },
    { $inc: { games_played: 1 }, $set: { game_xp_date: today, game_xp_today: used + xp } }
  );
  if (xp > 0) await addXp(userId, xp);
  const st = await touchStreak(userId);
  const badges = await checkBadges(userId);
  return { xp, capped: xp === 0 && c > 0, streak: st.streak, new_badges: badges };
}

async function profile(userId) {
  const u = await User.findById(userId).lean();
  const wk = weekKey();
  const lvl = xpLevel(u.xp || 0);
  const league = leagueFor(u.xp || 0);
  const idx = G.LEAGUES.findIndex((l) => l.id === league.id);
  const nextLeague = G.LEAGUES[idx + 1] || null;
  const today = dateKey();
  const alive = u.last_study_date && dayDiff(u.last_study_date, today) <= 1 + (u.streak_freezes || 0);
  return {
    xp: u.xp || 0,
    coins: u.coins || 0,
    ...lvl,
    league: { ...league, next: nextLeague ? { name_uz: nextLeague.name_uz, xp_needed: nextLeague.min_xp - (u.xp || 0) } : null },
    streak: alive ? u.streak || 0 : 0,
    best_streak: u.best_streak || 0,
    studied_today: u.last_study_date === today,
    streak_freezes: u.streak_freezes || 0,
    week_xp: u.week_key === wk ? u.week_xp || 0 : 0,
    badges: G.BADGES.map((b) => ({ id: b.id, name_uz: b.name_uz, desc_uz: b.desc_uz, icon: b.icon, earned: (u.badges || []).some((x) => x.id === b.id) })),
    equipped: u.equipped || {},
    owned_items: u.owned_items || [],
    games_played: u.games_played || 0,
    game_xp_left_today: Math.max(0, G.XP.game_cap_per_day - (u.game_xp_date === today ? u.game_xp_today : 0)),
  };
}

/** Haftalik reyting (faqat o'quvchilar; ism, XP, avatar — to'lov yo'q). */
async function weeklyBoard(userId, limit = 20) {
  const wk = weekKey();
  const top = await User.find({ role: 'student', status: 'active', week_key: wk, week_xp: { $gt: 0 } })
    .sort({ week_xp: -1, full_name: 1 }).limit(limit).select('full_name week_xp equipped streak').lean();
  const rows = top.map((u, i) => ({ rank: i + 1, name: u.full_name, week_xp: u.week_xp, avatar: u.equipped?.avatar || null, streak: u.streak || 0, me: String(u._id) === String(userId) }));
  let me = rows.find((r) => r.me) || null;
  if (!me) {
    const mine = await User.findById(userId).select('week_key week_xp').lean();
    if (mine && mine.week_key === wk && mine.week_xp > 0) {
      const ahead = await User.countDocuments({ role: 'student', status: 'active', week_key: wk, week_xp: { $gt: mine.week_xp } });
      me = { rank: ahead + 1, name: null, week_xp: mine.week_xp, me: true };
    }
  }
  return { week: wk, rows, me };
}

function shop(u) {
  const owned = new Set(u.owned_items || []);
  return G.SHOP.map((i) => ({ ...i, owned: i.consumable ? false : owned.has(i.id), equipped: Object.values(u.equipped || {}).includes(i.id) }));
}

async function buy(userId, itemId) {
  const item = G.SHOP.find((i) => i.id === itemId);
  if (!item) return { status: 404, message: 'Buyum topilmadi' };
  const u = await User.findById(userId).select('coins owned_items').lean();
  if (!item.consumable && (u.owned_items || []).includes(item.id)) return { status: 409, message: 'Bu buyum sizda bor' };
  if ((u.coins || 0) < item.price) return { status: 402, message: `Tanga yetmaydi (kerak: ${item.price})` };
  const filter = { _id: userId, coins: { $gte: item.price } };
  if (!item.consumable) filter.owned_items = { $ne: item.id };
  const update = { $inc: { coins: -item.price } };
  if (item.consumable) update.$inc.streak_freezes = 1; else update.$push = { owned_items: item.id };
  const r = await User.updateOne(filter, update);
  if (!r.modifiedCount) return { status: 409, message: 'Xarid bajarilmadi. Qayta urinib ko\'ring' };
  return { status: 200, item: item.id };
}

async function equip(userId, itemId) {
  const item = G.SHOP.find((i) => i.id === itemId);
  if (!item || !['avatar', 'frame', 'theme'].includes(item.kind)) return { status: 404, message: 'Buyum topilmadi' };
  const r = await User.updateOne({ _id: userId, owned_items: item.id }, { $set: { [`equipped.${item.kind}`]: item.id } });
  if (!r.matchedCount) return { status: 403, message: 'Bu buyum sizda yo\'q' };
  return { status: 200 };
}

module.exports = {
  dateKey, weekKey, xpLevel, leagueFor, touchStreak, addXp, checkBadges,
  onExerciseDone, onDayComplete, onExamPassed, onGameResult, profile, weeklyBoard, shop, buy, equip, TOTAL_DAYS,
};
