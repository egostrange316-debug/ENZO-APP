const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const { imageUpload } = require('../lib/imageUpload');
const c = require('../controllers/classController');

/** Admin obuna tekshiruvidan o'tkazilmaydi; o'quvchi — odatdagidek (bloklangan bo'lsa 403). */
const active = (req, res, next) => (req.user.role === 'admin' ? next() : checkSubscription(req, res, next));

const msgLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip), validate: false, message: { message: "Juda tez-tez yozyapsiz. Birozdan keyin urinib ko'ring." } });

router.use(protect, active);
router.get('/roster', c.roster);
router.get('/table', c.resultsTable);
router.post('/avatar', imageUpload('avatar'), c.setAvatar);
router.get('/attendance', c.getAttendance);
router.put('/attendance', (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ message: 'Faqat Admin' })), c.markAttendance);
router.get('/homework', c.listHomework);
router.post('/homework', adminOnly, c.createHomework);
router.delete('/homework/:id', adminOnly, c.deleteHomework);
router.post('/homework/:id/submit', imageUpload('hw'), c.submitHomework);
router.get('/messages', c.listMessages);
router.post('/messages', msgLimiter, c.sendMessage);

module.exports = router;
