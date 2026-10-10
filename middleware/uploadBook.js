const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const MAX_FILE_MB = Number(process.env.BOOK_MAX_FILE_MB) || 30;
const MAX_FILES = 10;
const UPLOAD_DIR = process.env.BOOK_UPLOAD_DIR || path.join(os.tmpdir(), 'book-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Fayllar RAMga emas, vaqtinchalik diskka yoziladi (katta PDF serverni to'ldirib yubormasligi uchun).
 * Disk nomi tasodifiy — mijoz yuborgan nom hech qachon yo'l sifatida ishlatilmaydi.
 * Tahlil tugagach (muvaffaqiyatli yoki xato bo'lsa ham) controller fayllarni o'chiradi.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    // Dastlabki saralash. Haqiqiy tur keyinroq fayl baytlaridan tekshiriladi (controller).
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/') || file.mimetype === 'application/octet-stream';
    cb(null, ok);
  },
}).array('files', MAX_FILES);

/** multer xatolarini tushunarli JSON javobga aylantiradi */
function uploadBooks(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Fayl juda katta (har biri ${MAX_FILE_MB} MB gacha). Kitobni qismlarga bo'lib yuklang.` });
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ message: `Bir vaqtda ${MAX_FILES} tagacha fayl yuklash mumkin` });
    console.error('Yuklash xatosi:', err);
    return res.status(400).json({ message: 'Faylni qabul qilib bo‘lmadi' });
  });
}

// Butun kitob PDF'i (bo'lib yuklash uchun): bitta fayl, kattaroq chegara
const PLAN_MAX_MB = Number(process.env.BOOK_PLAN_MAX_MB) || 150;
const planUpload = multer({
  storage,
  limits: { fileSize: PLAN_MAX_MB * 1024 * 1024, files: 1 },
}).single('file');

function uploadPlanPdf(req, res, next) {
  planUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Fayl juda katta (${PLAN_MAX_MB} MB gacha)` });
    console.error('Reja yuklash xatosi:', err);
    return res.status(400).json({ message: 'Faylni qabul qilib bo‘lmadi' });
  });
}

module.exports = { uploadBooks, uploadPlanPdf, MAX_FILE_MB, MAX_FILES, PLAN_MAX_MB, UPLOAD_DIR };
