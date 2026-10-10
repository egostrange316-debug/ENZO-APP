const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MAX_MB = Number(process.env.IMAGE_MAX_MB) || 8;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } }).single('file');

/** Haqiqiy tur fayl baytlaridan aniqlanadi (mijoz yuborgan MIME ga ishonilmaydi). */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'gif';
  return null;
}

/** multer + tur tekshiruvi. Muvaffaqiyatli bo'lsa req.savedImage = '/uploads/<tasodifiy>.<ext>' */
function imageUpload(prefix = 'img') {
  return (req, res, next) => {
    upload(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Rasm juda katta (${MAX_MB} MB gacha)` });
        return res.status(400).json({ message: "Faylni qabul qilib bo'lmadi" });
      }
      if (!req.file) return res.status(400).json({ message: 'Rasm tanlanmagan' });
      const ext = sniff(req.file.buffer);
      if (!ext) return res.status(400).json({ message: "Faqat rasm (JPG, PNG, WEBP, GIF) yuklash mumkin" });
      const name = `${prefix}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
      try {
        await fs.promises.writeFile(path.join(UPLOAD_DIR, name), req.file.buffer);
      } catch (e) {
        console.error('Rasm saqlanmadi:', e.message);
        return res.status(500).json({ message: 'Rasmni saqlab bo\'lmadi' });
      }
      req.savedImage = `/uploads/${name}`;
      next();
    });
  };
}

module.exports = { imageUpload, UPLOAD_DIR, sniff };
