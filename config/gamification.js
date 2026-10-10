/**
 * O'yin tizimi sozlamalari (XP, streak, nishonlar, ligalar, do'kon, o'yinlar). Hammasi bitta joyda.
 * Qoida: mashqda yurak/urinish cheklovi YO'Q. XP faqat rag'bat uchun, hech narsani yopib qo'ymaydi.
 */
const XP = {
  exercise_first_try: 10,   // savolga birinchi urinishda to'g'ri javob
  exercise_retry: 4,        // xatodan keyin to'g'ri topdi
  day_complete: 50,         // kunni yakunlash
  exam_pass: 80,            // mini/mid imtihondan o'tish
  exam_perfect_bonus: 40,   // 100% bilan o'tish
  game_cap_per_day: 120,    // o'yinlardan bir kunda olinadigan eng ko'p XP
  game_per_correct: 3,
  game_perfect_bonus: 10,
};
const COINS_PER_XP = 0.2; // 5 XP = 1 tanga
const STREAK_MILESTONES = { 3: 10, 7: 30, 14: 60, 30: 150, 60: 300, 100: 600 }; // kun -> bonus tanga

// Daraja (umumiy XP bo'yicha): har daraja uchun kerakli XP
const XP_LEVELS = Array.from({ length: 50 }, (_, i) => Math.round(60 * i * (i + 1) / 2)); // 0, 60, 180, 360, ...

const LEAGUES = [
  { id: 'bronze', name_uz: 'Bronza', icon: '🥉', min_xp: 0 },
  { id: 'silver', name_uz: 'Kumush', icon: '🥈', min_xp: 600 },
  { id: 'gold', name_uz: 'Oltin', icon: '🥇', min_xp: 2000 },
  { id: 'platinum', name_uz: 'Platina', icon: '💠', min_xp: 5000 },
  { id: 'diamond', name_uz: 'Olmos', icon: '💎', min_xp: 10000 },
];

// Nishonlar. cond: statistikaga qarab tekshiriladi (gameService.statsFor)
const BADGES = [
  { id: 'first_step', name_uz: 'Birinchi qadam', desc_uz: 'Birinchi kunni yakunla', icon: '👣', cond: { days_done: 1 } },
  { id: 'week_hero', name_uz: 'Hafta qahramoni', desc_uz: '7 kun ketma-ket o\'qi', icon: '🔥', cond: { streak: 7 } },
  { id: 'month_hero', name_uz: 'Oy qahramoni', desc_uz: '30 kun ketma-ket o\'qi', icon: '🌙', cond: { streak: 30 } },
  { id: 'streak_100', name_uz: 'Yuz kun!', desc_uz: '100 kun ketma-ket o\'qi', icon: '🏆', cond: { streak: 100 } },
  { id: 'days_10', name_uz: '10 kun', desc_uz: '10 ta darsni tugat', icon: '📘', cond: { days_done: 10 } },
  { id: 'days_50', name_uz: '50 kun', desc_uz: '50 ta darsni tugat', icon: '📗', cond: { days_done: 50 } },
  { id: 'days_100', name_uz: '100 kun', desc_uz: '100 ta darsni tugat', icon: '📕', cond: { days_done: 100 } },
  { id: 'words_100', name_uz: '100 ta so\'z', desc_uz: '100 ta so\'z o\'rgan', icon: '🔤', cond: { words: 100 } },
  { id: 'words_500', name_uz: '500 ta so\'z', desc_uz: '500 ta so\'z o\'rgan', icon: '📚', cond: { words: 500 } },
  { id: 'words_1000', name_uz: '1000 ta so\'z', desc_uz: '1000 ta so\'z o\'rgan', icon: '🧠', cond: { words: 1000 } },
  { id: 'exam_pass', name_uz: 'Imtihon g\'olibi', desc_uz: 'Birinchi imtihondan o\'t', icon: '✅', cond: { exams_passed: 1 } },
  { id: 'exam_perfect', name_uz: 'Mukammal!', desc_uz: 'Imtihonda 100% ol', icon: '💯', cond: { perfect_exams: 1 } },
  { id: 'gamer', name_uz: 'O\'yinchi', desc_uz: '10 ta o\'yin o\'yna', icon: '🎮', cond: { games_played: 10 } },
  { id: 'gamer_pro', name_uz: 'O\'yin ustasi', desc_uz: '50 ta o\'yin o\'yna', icon: '🕹️', cond: { games_played: 50 } },
  { id: 'xp_1000', name_uz: '1000 XP', desc_uz: '1000 XP to\'pla', icon: '⭐', cond: { xp: 1000 } },
  { id: 'xp_5000', name_uz: '5000 XP', desc_uz: '5000 XP to\'pla', icon: '🌟', cond: { xp: 5000 } },
  { id: 'level_up', name_uz: 'Yangi daraja', desc_uz: 'Kursning keyingi darajasiga o\'t', icon: '🚀', cond: { levels_done: 1 } },
];

// Do'kon (tanga bilan). kind: avatar | frame | theme | boost
const SHOP = [
  { id: 'av_lion', kind: 'avatar', name_uz: 'Sher', icon: '🦁', price: 0 },
  { id: 'av_cat', kind: 'avatar', name_uz: 'Mushuk', icon: '🐱', price: 0 },
  { id: 'av_panda', kind: 'avatar', name_uz: 'Panda', icon: '🐼', price: 40 },
  { id: 'av_fox', kind: 'avatar', name_uz: 'Tulki', icon: '🦊', price: 40 },
  { id: 'av_rabbit', kind: 'avatar', name_uz: 'Quyon', icon: '🐰', price: 40 },
  { id: 'av_koala', kind: 'avatar', name_uz: 'Koala', icon: '🐨', price: 60 },
  { id: 'av_tiger', kind: 'avatar', name_uz: 'Yo\'lbars', icon: '🐯', price: 60 },
  { id: 'av_unicorn', kind: 'avatar', name_uz: 'Yakkashox', icon: '🦄', price: 120 },
  { id: 'av_dragon', kind: 'avatar', name_uz: 'Ajdaho', icon: '🐲', price: 150 },
  { id: 'av_robot', kind: 'avatar', name_uz: 'Robot', icon: '🤖', price: 150 },
  { id: 'av_rocket', kind: 'avatar', name_uz: 'Raketa', icon: '🚀', price: 200 },
  { id: 'fr_gold', kind: 'frame', name_uz: 'Oltin hoshiya', icon: '🟡', price: 80, color: '#FFD400' },
  { id: 'fr_blue', kind: 'frame', name_uz: 'Ko\'k hoshiya', icon: '🔵', price: 60, color: '#1E9FFF' },
  { id: 'fr_pink', kind: 'frame', name_uz: 'Pushti hoshiya', icon: '🟣', price: 60, color: '#FF3366' },
  { id: 'fr_green', kind: 'frame', name_uz: 'Yashil hoshiya', icon: '🟢', price: 60, color: '#00C48C' },
  { id: 'th_night', kind: 'theme', name_uz: 'Tungi mavzu', icon: '🌌', price: 100 },
  { id: 'th_sunset', kind: 'theme', name_uz: 'Shom mavzusi', icon: '🌇', price: 100 },
  { id: 'freeze', kind: 'boost', name_uz: 'Streak himoyasi', icon: '🧊', price: 50, desc_uz: 'Bir kun darsni o\'tkazib yuborsang ham streak saqlanadi', consumable: true },
];

// O'yinlar: hammasi shu kunning (va o'tgan kunlarning) so'zlaridan quriladi — alohida kontent kerak emas
const GAMES = [
  { id: 'match', name_uz: 'Juftini top', icon: '🧩', desc_uz: 'Inglizcha so\'zni tarjimasi bilan juftla', rounds: 6 },
  { id: 'memory', name_uz: 'Xotira kartalari', icon: '🃏', desc_uz: 'Kartalarni ochib, juftlarni top', rounds: 6 },
  { id: 'scramble', name_uz: 'Harflarni tering', icon: '🔠', desc_uz: 'Aralashgan harflardan so\'zni yig\'', rounds: 6 },
  { id: 'listen', name_uz: 'Eshit va tanla', icon: '🎧', desc_uz: 'Eshitgan so\'zingni toping', rounds: 8 },
  { id: 'speed', name_uz: 'Tezkor test', icon: '⚡', desc_uz: '60 soniyada ko\'proq so\'zni toping', rounds: 20 },
  { id: 'hangman', name_uz: 'Osilgan odam', icon: '🎯', desc_uz: 'Harflarni taxmin qilib so\'zni toping', rounds: 5 },
];

module.exports = { XP, COINS_PER_XP, STREAK_MILESTONES, XP_LEVELS, LEAGUES, BADGES, SHOP, GAMES };
