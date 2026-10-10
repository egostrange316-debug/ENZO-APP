const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const { uploadBooks } = require('../middleware/uploadBook');
const { uploadBook, listBooks, getBook, deleteBook, assignBook } = require('../controllers/bookController');

// Gemini bepul kvotasini himoya qilish: bir IP dan soatiga 30 ta yuklash
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.BOOK_UPLOADS_PER_HOUR) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p yuklash. Birozdan so'ng qayta urinib ko'ring." },
});

router.use(protect, adminOnly);

router.post('/', uploadLimiter, uploadBooks, uploadBook);
router.get('/', listBooks);
router.get('/:id', getBook);
router.post('/:id/assign', assignBook);
router.delete('/:id', deleteBook);

module.exports = router;
