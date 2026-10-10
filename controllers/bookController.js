const fsp = require('fs/promises');
const BookMaterial = require('../models/BookMaterial');
const bookService = require('../services/bookService');
const { createQueue } = require('../lib/jobQueue');
const StudyPlan = require('../models/StudyPlan');
const { LEVELS, TOTAL_DAYS, isValidDay, deriveLessonType } = require('../config/curriculum');

const queue = createQueue(Number(process.env.BOOK_CONCURRENCY) || 2);
const STALE_MS = 10 * 60 * 1000;
const MAX_TOTAL_MB = 60;

const cleanName = (raw) =>
  // multer nomni latin1 deb o'qiydi — o'zbekcha/kirillcha nomlar buzilmasligi uchun utf8 ga qaytaramiz
  Buffer.from(String(raw || 'fayl'), 'latin1').toString('utf8').replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 120) || 'fayl';

async function readHeader(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    return buf.slice(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const removeFiles = (files) => Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));

/** Server qayta ishga tushganda yoki ish osilib qolganda 'processing' da qolgan yozuvlarni 'failed' qiladi */
async function failStale(filter = {}) {
  await BookMaterial.updateMany(
    { ...filter, status: 'processing', started_at: { $lt: new Date(Date.now() - STALE_MS) } },
    {
      $set: {
        status: 'failed',
        finished_at: new Date(),
        error_message: 'Tahlil vaqtida to‘xtadi (server qayta ishga tushgan bo‘lishi mumkin). Faylni qayta yuklang.',
      },
    }
  );
}

/** Fonda ishlaydi: Gemini'ga yuboradi va natijani saqlaydi. Vaqtinchalik fayllarni doim tozalaydi. */
async function processBook(bookId, files, { level, keepTitle }) {
  try {
    const { model, data } = await bookService.analyzeBookFiles(
      files.map((f) => ({ path: f.path, mimeType: f.mimeType, displayName: f.displayName })),
      { level }
    );
    const set = {
      status: 'ready',
      ai_model: model,
      finished_at: new Date(),
      warnings: data.warnings,
      writing: data.writing,
      reading: data.reading,
      listening: data.listening,
      speaking: data.speaking,
    };
    if (!keepTitle && data.title) set.title = data.title;
    await BookMaterial.updateOne({ _id: bookId }, { $set: set });
  } catch (e) {
    console.error('Kitob tahlili xatosi:', e);
    await BookMaterial.updateOne(
      { _id: bookId },
      {
        $set: {
          status: 'failed',
          finished_at: new Date(),
          error_message: bookService.friendlyError(e),
          error_detail: String(e?.message || e).slice(0, 300),
        },
      }
    ).catch(() => {});
  } finally {
    await removeFiles(files);
  }
}

/** POST /api/admin/books  (multipart: files[], title?, level?) -> 202 { id, status } */
const uploadBook = async (req, res) => {
  const incoming = req.files || [];
  try {
    if (!incoming.length) return res.status(400).json({ message: 'Fayl tanlanmagan' });

    const totalMb = incoming.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
    if (totalMb > MAX_TOTAL_MB) {
      await removeFiles(incoming);
      return res.status(413).json({ message: `Fayllar jami ${MAX_TOTAL_MB} MB dan oshmasligi kerak` });
    }

    // Haqiqiy turni baytlardan aniqlaymiz (.pdf nomli matn fayl o'tmaydi)
    const files = [];
    for (const f of incoming) {
      const mimeType = bookService.detectMime(await readHeader(f.path));
      const displayName = cleanName(f.originalname);
      if (!mimeType) {
        await removeFiles(incoming);
        return res.status(400).json({ message: `"${displayName}" PDF yoki rasm (JPG, PNG, WEBP, HEIC) emas` });
      }
      files.push({ path: f.path, size: f.size, mimeType, displayName });
    }

    const level = req.body.level && LEVELS.includes(req.body.level) ? req.body.level : null;
    const teacherTitle = String(req.body.title || '').trim().slice(0, 150);

    const book = await BookMaterial.create({
      uploaded_by: req.user._id,
      title: teacherTitle || `Yuklangan: ${files[0].displayName}`,
      level_hint: level,
      source_files: files.map((f) => ({ original_name: f.displayName, mime_type: f.mimeType, size_bytes: f.size })),
      status: 'processing',
    });

    queue.enqueue(() => processBook(book._id, files, { level, keepTitle: Boolean(teacherTitle) }));

    return res.status(202).json({ id: book._id, status: 'processing', title: book.title });
  } catch (error) {
    console.error('uploadBook xatosi:', error);
    await removeFiles(incoming);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

const summarize = (b) => ({
  id: b._id,
  title: b.title,
  status: b.status,
  level_hint: b.level_hint,
  plan: b.plan ?? null,
  section_title: b.section_title,
  assigned_day: b.assigned_day ?? null,
  error_message: b.error_message,
  warnings: b.warnings || [],
  source_files: b.source_files,
  created_at: b.createdAt,
  counts: {
    vocabulary: b.writing?.vocabulary?.length || 0,
    grammar: b.writing?.grammar?.length || 0,
    reading_questions: b.reading?.questions?.length || 0,
    listening_questions: b.listening?.questions?.length || 0,
    speaking_questions: b.speaking?.questions?.length || 0,
  },
});

/** GET /api/admin/books */
const listBooks = async (req, res) => {
  try {
    await failStale();
    const books = await BookMaterial.find().sort({ createdAt: -1 }).limit(50).lean();
    res.status(200).json({ books: books.map(summarize) });
  } catch (error) {
    console.error('listBooks xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** GET /api/admin/books/:id — to'liq mazmun (frontend holatni shu orqali so'rab turadi) */
const getBook = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    await failStale({ _id: req.params.id });
    const book = await BookMaterial.findById(req.params.id).lean();
    if (!book) return res.status(404).json({ message: 'Topilmadi' });
    res.status(200).json({ book });
  } catch (error) {
    console.error('getBook xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** DELETE /api/admin/books/:id */
const deleteBook = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    await BookMaterial.deleteOne({ _id: req.params.id });
    res.status(200).json({ message: 'O‘chirildi' });
  } catch (error) {
    console.error('deleteBook xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/books/:id/assign   { day_number: 12 }  yoki  { day_number: null } (biriktirishni bekor qilish)
 * Tayyor (ready) to'plamni oddiy kunga biriktiradi: o'quvchi shu kunga yetganda mashqlar dars ichida chiqadi
 * va hammasi to'g'ri bajarilmaguncha kun yakunlanmaydi. Bir kunga bir nechta to'plam biriktirish mumkin.
 * Kunning rejasi (Unit) yo'q bo'lsa, to'plam sarlavhali bo'sh reja avtomatik yaratiladi.
 */
const assignBook = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    const book = await BookMaterial.findById(req.params.id);
    if (!book) return res.status(404).json({ message: 'Topilmadi' });

    const raw = req.body?.day_number;
    if (raw === null) {
      book.assigned_day = null;
      await book.save();
      return res.status(200).json({ message: 'Biriktirish bekor qilindi', book: summarize(book) });
    }

    const day = Number(raw);
    if (!isValidDay(day)) return res.status(400).json({ message: `Kun raqami 1 dan ${TOTAL_DAYS} gacha bo'lishi kerak` });
    if (book.status !== 'ready') return res.status(409).json({ message: "Faqat tayyor to'plamni biriktirish mumkin" });
    if (deriveLessonType(day) !== 'regular') {
      return res.status(400).json({
        message: `${day}-kun imtihon kuni. Kitob mashqlari faqat oddiy kunlarga biriktiriladi (kurs xaritasida imtihon kunlari alohida belgilangan).`,
      });
    }

    if (!(await StudyPlan.exists({ day_number: day }))) {
      await StudyPlan.create({ day_number: day, unit_title: book.title });
    }
    book.assigned_day = day;
    await book.save();
    res.status(200).json({ message: `${day}-kunga biriktirildi`, book: summarize(book) });
  } catch (error) {
    console.error('assignBook xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { uploadBook, listBooks, getBook, deleteBook, assignBook, processBook, readHeader, removeFiles, queue };
