const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const { uploadPlanPdf } = require('../middleware/uploadBook');
const { createPlan, listPlans, getPlan, placePlan, retryPlan, deletePlan } = require('../controllers/bookPlanController');

const planLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.BOOK_PLANS_PER_HOUR) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p yuklash. Birozdan so'ng qayta urinib ko'ring." },
});

router.use(protect, adminOnly);

router.post('/', planLimiter, uploadPlanPdf, createPlan);
router.get('/', listPlans);
router.get('/:id', getPlan);
router.post('/:id/place', placePlan);
router.post('/:id/retry', retryPlan);
router.delete('/:id', deletePlan);

module.exports = router;
