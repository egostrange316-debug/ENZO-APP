const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getMe,
  getTodayLesson,
  completeRegularLesson,
  submitExamScore,
} = require('../controllers/studentController');

// /me — bloklangan o'quvchi ham holatini bilishi kerak (checkSubscription YO'Q)
router.get('/me', protect, getMe);

// Dars bilan bog'liq hamma narsa: avval token, keyin obuna/blok tekshiruvi
router.get('/lesson/today', protect, checkSubscription, getTodayLesson);
router.post('/lesson/complete', protect, checkSubscription, completeRegularLesson);
router.post('/exam/submit', protect, checkSubscription, submitExamScore);

module.exports = router;
