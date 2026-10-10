const User = require('../models/User');
const G = require('../config/gamification');
const game = require('../services/gameService');
const StudyPlan = require('../models/StudyPlan');
const BookMaterial = require('../models/BookMaterial');
const { TOTAL_DAYS } = require('../config/curriculum');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('gameController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

const getProfile = wrap(async (req, res) => res.status(200).json(await game.profile(req.user._id)));

const getBoard = wrap(async (req, res) => res.status(200).json(await game.weeklyBoard(req.user._id)));

const listGames = wrap(async (req, res) => res.status(200).json({ games: G.GAMES }));

/** O'yin so'zlari: bugungi dars so'zlari + oxirgi kunlardagi so'zlar (takrorlash). */
const getGameWords = wrap(async (req, res) => {
  const day = Math.min(req.user.current_day, TOTAL_DAYS);
  const from = Math.max(1, day - 14);
  const [books, plans] = await Promise.all([
    BookMaterial.find({ assigned_day: { $gte: from, $lte: day }, status: 'ready' }).select('assigned_day writing.vocabulary').lean(),
    StudyPlan.find({ day_number: { $gte: from, $lte: day } }).select('day_number vocabulary').lean(),
  ]);
  const seen = new Set();
  const today = [];
  const earlier = [];
  const push = (arr, v) => {
    const k = String(v.word).toLowerCase();
    if (!v.word || !v.translation_uz || seen.has(k)) return;
    seen.add(k);
    arr.push({ word: v.word, translation_uz: v.translation_uz });
  };
  for (const b of books.sort((a, c) => c.assigned_day - a.assigned_day)) for (const v of b.writing?.vocabulary || []) push(b.assigned_day === day ? today : earlier, v);
  for (const p of plans) for (const v of p.vocabulary || []) push(p.day_number === day ? today : earlier, v);
  res.status(200).json({ day, today, earlier, words: [...today, ...earlier].slice(0, 80) });
});

const postResult = wrap(async (req, res) => {
  const r = await game.onGameResult(req.user._id, req.body || {});
  if (r.error) return res.status(400).json({ message: r.error });
  res.status(200).json(r);
});

const getShop = wrap(async (req, res) => {
  const u = await User.findById(req.user._id).select('coins owned_items equipped streak_freezes').lean();
  res.status(200).json({ coins: u.coins || 0, streak_freezes: u.streak_freezes || 0, items: game.shop(u) });
});

const postBuy = wrap(async (req, res) => {
  const r = await game.buy(req.user._id, String(req.body?.item_id || ''));
  if (r.status !== 200) return res.status(r.status).json({ message: r.message });
  res.status(200).json({ ok: true, profile: await game.profile(req.user._id) });
});

const postEquip = wrap(async (req, res) => {
  const r = await game.equip(req.user._id, String(req.body?.item_id || ''));
  if (r.status !== 200) return res.status(r.status).json({ message: r.message });
  res.status(200).json({ ok: true });
});

module.exports = { getProfile, getBoard, listGames, getGameWords, postResult, getShop, postBuy, postEquip };
