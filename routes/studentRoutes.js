const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getMe,
  getTodayLesson,
  getReviewLesson,
  getMyProgress,
  getLeaderboard,
  answerExercise,
  completeRegularLesson,
  submitExamScore,
} = require('../controllers/studentController');

// /me — bloklangan o'quvchi ham holatini bilishi kerak (checkSubscription YO'Q)
router.get('/me', protect, getMe);

router.get('/progress', protect, getMyProgress);

// Dars bilan bog'liq hamma narsa: avval token, keyin obuna/blok tekshiruvi
router.get('/lesson/today', protect, checkSubscription, getTodayLesson);
router.get('/lesson/day/:day', protect, checkSubscription, getReviewLesson);
router.get('/leaderboard', protect, checkSubscription, getLeaderboard);
router.post('/exercise/answer', protect, checkSubscription, answerExercise);
router.post('/lesson/complete', protect, checkSubscription, completeRegularLesson);
router.post('/exam/submit', protect, checkSubscription, submitExamScore);

const rateLimit = require('express-rate-limit');
const pron = require('../controllers/pronunciationController');
// Gemini kvotasini himoya qilish: o'quvchiga daqiqasiga 12 ta urinish
const pronLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip), validate: false, message: { message: "Juda tez-tez urinyapsiz. Bir daqiqadan keyin qayta urinib ko'ring." } });
router.post('/pronunciation', protect, checkSubscription, pronLimiter, pron.assessPronunciation);
router.get('/pronunciation/history', protect, checkSubscription, pron.myHistory);
const sched = require('../controllers/scheduleController');
router.get('/schedule', protect, checkSubscription, sched.studentSchedule);
const gc = require('../controllers/gameController');
router.get('/game/profile', protect, checkSubscription, gc.getProfile);
router.get('/game/board', protect, checkSubscription, gc.getBoard);
router.get('/game/list', protect, checkSubscription, gc.listGames);
router.get('/game/words', protect, checkSubscription, gc.getGameWords);
router.post('/game/result', protect, checkSubscription, gc.postResult);
router.get('/game/shop', protect, checkSubscription, gc.getShop);
router.post('/game/buy', protect, checkSubscription, gc.postBuy);
router.post('/game/equip', protect, checkSubscription, gc.postEquip);

const pr = require('../controllers/practiceController');
router.get('/practice', protect, checkSubscription, pr.summary);
router.get('/practice/words', protect, checkSubscription, pr.words);
router.get('/practice/mistakes', protect, checkSubscription, pr.mistakes);
router.get('/practice/session', protect, checkSubscription, pr.session);
router.post('/practice/answer', protect, checkSubscription, pr.answer);
router.post('/practice/complete', protect, checkSubscription, pr.complete);

module.exports = router;
