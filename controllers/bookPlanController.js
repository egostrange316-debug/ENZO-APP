const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const BookPlan = require('../models/BookPlan');
const BookMaterial = require('../models/BookMaterial');
const StudyPlan = require('../models/StudyPlan');
const { UPLOAD_DIR } = require('../middleware/uploadBook');
const bookController = require('./bookController');
const { planParts, loadPdf, writeRange } = require('../lib/pdfSplit');
const { LEVELS, LEVEL_LABELS, levelRange, deriveLessonType, regularDaysOfLevel } = require('../config/curriculum');

const MAX_SECTIONS = 60;
const MAX_SETS = 200;
const PLANS_DIR = path.join(UPLOAD_DIR, 'plans');

const cleanTitle = (s, n = 120) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const isId = (id) => /^[a-f\d]{24}$/i.test(String(id));

function validateSections(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Kamida bitta bo'lim kerak" };
  if (raw.length > MAX_SECTIONS) return { error: `Bo'limlar ${MAX_SECTIONS} tadan oshmasin` };
  const sections = [];
  let sets = 0;
  for (const [i, s] of raw.entries()) {
    const from = Number(s.from_page);
    const to = Number(s.to_page);
    const days = Number(s.days);
    const title = cleanTitle(s.title) || `Bo'lim ${i + 1}`;
    if (![from, to, days].every(Number.isInteger) || from < 1 || to < from || days < 1) {
      return { error: `"${title}": sahifa oralig'i yoki kunlar soni noto'g'ri` };
    }
    sets += Math.min(days, to - from + 1);
    sections.push({ title, from_page: from, to_page: to, days });
  }
  if (sets > MAX_SETS) return { error: `Jami qismlar ${MAX_SETS} tadan oshmasin (hozir ${sets})` };
  return { sections, sets };
}

/** Bitta qismni (kitob sahifalari from..to) kesib, tahlil navbatiga qo'yadi */
async function enqueuePart({ planDoc, srcDoc, bookDoc, part, level }) {
  const pdfFrom = part.from + planDoc.page_offset;
  const pdfTo = part.to + planDoc.page_offset;
  const dir = path.join(PLANS_DIR, String(planDoc._id));
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${bookDoc._id}.pdf`);
  await writeRange(srcDoc, pdfFrom, pdfTo, dest);
  const size = (await fsp.stat(dest)).size;
  const file = { path: dest, size, mimeType: 'application/pdf', displayName: `${part.section} ${part.from}-${part.to}.pdf` };
  bookController.queue.enqueue(() => bookController.processBook(bookDoc._id, [file], { level, keepTitle: true }));
}

/** Fonda: PDF ni kesadi, to'plam yozuvlarini yaratadi va navbatga qo'yadi */
async function splitAndEnqueue(planDoc, parts, uploadedBy) {
  try {
    const srcDoc = await loadPdf(planDoc.original_path);
    const pageCount = srcDoc.getPageCount();
    const last = parts[parts.length - 1];
    const maxNeeded = Math.max(...parts.map((p) => p.to)) + planDoc.page_offset;
    if (maxNeeded > pageCount) {
      throw new Error(`PDF da ${pageCount} ta sahifa bor, lekin reja ${maxNeeded}-sahifagacha so'raydi (bet farqini tekshiring)`);
    }
    void last;

    const books = [];
    for (const [i, part] of parts.entries()) {
      const suffix = part.parts > 1 ? ` (${part.part}/${part.parts})` : '';
      books.push(
        await BookMaterial.create({
          uploaded_by: uploadedBy,
          title: `${planDoc.title} · ${part.section}${suffix}`,
          level_hint: planDoc.level,
          plan: planDoc._id,
          plan_order: i,
          section_title: part.section,
          source_pages: { from: part.from, to: part.to },
          source_files: [{ original_name: `${part.section} ${part.from}-${part.to}`, mime_type: 'application/pdf', size_bytes: 0 }],
          status: 'processing',
        })
      );
    }
    await BookPlan.updateOne({ _id: planDoc._id }, { $set: { status: 'running', total_sets: books.length } });
    for (const [i, part] of parts.entries()) {
      await enqueuePart({ planDoc, srcDoc, bookDoc: books[i], part, level: planDoc.level });
    }
  } catch (e) {
    console.error('Reja bo‘lish xatosi:', e);
    await BookPlan.updateOne(
      { _id: planDoc._id },
      { $set: { status: 'failed', error_message: String(e.message || e).slice(0, 300) } }
    ).catch(() => {});
    await BookMaterial.updateMany(
      { plan: planDoc._id, status: 'processing' },
      { $set: { status: 'failed', error_message: 'PDF ni qismlarga bo‘lib bo‘lmadi', finished_at: new Date() } }
    ).catch(() => {});
  }
}

/**
 * POST /api/admin/book-plans   multipart: file (PDF), title, level, page_offset?, sections (JSON)
 *   sections: [{ title, from_page, to_page, days }]  — KITOB sahifa raqamlari
 * -> 202 { id, total_sets }. Kesish va tahlil fonda ketadi.
 */
const createPlan = async (req, res) => {
  const file = req.file;
  const cleanup = () => (file ? fsp.unlink(file.path).catch(() => {}) : Promise.resolve());
  try {
    if (!file) return res.status(400).json({ message: 'PDF fayl tanlanmagan' });

    const header = await bookController.readHeader(file.path);
    if (header.slice(0, 5).toString('latin1') !== '%PDF-') {
      await cleanup();
      return res.status(400).json({ message: 'Bu PDF fayl emas' });
    }

    const title = cleanTitle(req.body.title, 100);
    const level = req.body.level;
    if (!title) { await cleanup(); return res.status(400).json({ message: 'Kitob nomi kerak' }); }
    if (!LEVELS.includes(level)) { await cleanup(); return res.status(400).json({ message: 'Daraja tanlanmagan' }); }

    const offset = req.body.page_offset === undefined || req.body.page_offset === '' ? 1 : Number(req.body.page_offset);
    if (!Number.isInteger(offset) || offset < -50 || offset > 200) {
      await cleanup();
      return res.status(400).json({ message: "Bet farqi (page_offset) noto'g'ri" });
    }

    let rawSections;
    try { rawSections = JSON.parse(req.body.sections); } catch (e) { rawSections = null; }
    const v = validateSections(rawSections);
    if (v.error) { await cleanup(); return res.status(400).json({ message: v.error }); }

    // Fayl doimiy joyga ko'chiriladi (qayta urinish uchun), multer nomi tasodifiy
    await fsp.mkdir(PLANS_DIR, { recursive: true });
    const planDoc = await BookPlan.create({
      uploaded_by: req.user._id,
      title,
      level,
      page_offset: offset,
      sections: v.sections,
      status: 'splitting',
      total_sets: v.sets,
    });
    const kept = path.join(PLANS_DIR, `${planDoc._id}.src.pdf`);
    await fsp.rename(file.path, kept);
    planDoc.original_path = kept;
    await planDoc.save();

    const parts = planParts(v.sections);
    setImmediate(() => splitAndEnqueue(planDoc, parts, req.user._id));

    return res.status(202).json({ id: planDoc._id, status: 'splitting', total_sets: parts.length });
  } catch (error) {
    console.error('createPlan xatosi:', error);
    await cleanup();
    res.status(500).json({ message: 'Server xatosi' });
  }
};

async function planSummary(plan, sets) {
  const mine = sets.filter((s) => String(s.plan) === String(plan._id));
  const count = (st) => mine.filter((s) => s.status === st).length;
  return {
    id: plan._id,
    title: plan.title,
    level: plan.level,
    status: plan.status,
    error_message: plan.error_message,
    created_at: plan.createdAt,
    total_sets: plan.total_sets,
    ready: count('ready'),
    failed: count('failed'),
    processing: count('processing'),
    placed: mine.filter((s) => s.assigned_day).length,
    can_retry: Boolean(plan.original_path && fs.existsSync(plan.original_path)),
  };
}

/** GET /api/admin/book-plans */
const listPlans = async (req, res) => {
  try {
    const plans = await BookPlan.find().sort({ createdAt: -1 }).limit(30).lean();
    const sets = await BookMaterial.find({ plan: { $in: plans.map((p) => p._id) } }).select('plan status assigned_day').lean();
    res.status(200).json({ plans: await Promise.all(plans.map((p) => planSummary(p, sets))) });
  } catch (error) {
    console.error('listPlans xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** GET /api/admin/book-plans/:id — to'plamlar ro'yxati bilan */
const getPlan = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    const plan = await BookPlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ message: 'Topilmadi' });
    const sets = await BookMaterial.find({ plan: plan._id })
      .select('title status error_message warnings assigned_day plan_order section_title source_pages plan')
      .sort({ plan_order: 1 })
      .lean();
    res.status(200).json({
      plan: await planSummary(plan, sets),
      sections: plan.sections,
      sets: sets.map((s) => ({
        id: s._id, order: s.plan_order, title: s.title, section: s.section_title, pages: s.source_pages,
        status: s.status, error_message: s.error_message, warnings: s.warnings || [], assigned_day: s.assigned_day ?? null,
      })),
    });
  } catch (error) {
    console.error('getPlan xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * POST /api/admin/book-plans/:id/place
 * Reja to'plamlarini daraja kunlariga TARTIB bilan joylaydi: i-to'plam -> darajaning i-bo'sh oddiy kuni
 * (imtihon kunlari o'tkazib yuboriladi; boshqa reja yoki qo'lda biriktirilgan kunlar band hisoblanadi).
 * Tayyor bo'lmagan to'plamning kuni bo'sh qoldiriladi — keyin qayta urinib, yana "joylash" bosilsa shu kunga tushadi.
 * Idempotent: qayta bosish natijani qayta hisoblaydi.
 */
const placePlan = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    const plan = await BookPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Topilmadi' });

    const sets = await BookMaterial.find({ plan: plan._id }).sort({ plan_order: 1 });
    if (!sets.length) return res.status(409).json({ message: "Hali to'plamlar yaratilmagan (PDF kesilmoqda)" });

    const occupiedDocs = await BookMaterial.find({ plan: { $ne: plan._id }, assigned_day: { $ne: null } }).select('assigned_day').lean();
    const occupied = new Set(occupiedDocs.map((b) => b.assigned_day));
    const free = regularDaysOfLevel(plan.level).filter((d) => !occupied.has(d));

    const placed = [];
    let overflow = 0;
    for (const [i, set] of sets.entries()) {
      const day = free[i];
      if (day === undefined) { overflow++; if (set.assigned_day !== null) { set.assigned_day = null; await set.save(); } continue; }
      const newDay = set.status === 'ready' ? day : null;
      if (set.assigned_day !== newDay) { set.assigned_day = newDay; await set.save(); }
      if (newDay) {
        if (!(await StudyPlan.exists({ day_number: newDay }))) {
          await StudyPlan.create({ day_number: newDay, unit_title: set.title });
        }
        placed.push({ day: newDay, title: set.title });
      }
    }

    res.status(200).json({
      message: `${placed.length} ta to'plam kunlarga joylandi`,
      placed,
      waiting: sets.filter((s) => s.status !== 'ready').length,
      overflow,
      free_days_in_level: free.length,
    });
  } catch (error) {
    console.error('placePlan xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** POST /api/admin/book-plans/:id/retry — xato bo'lgan qismlarni asl PDF dan qayta kesib, qayta tahlil qiladi */
const retryPlan = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    const plan = await BookPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Topilmadi' });
    if (!plan.original_path || !fs.existsSync(plan.original_path)) {
      return res.status(410).json({ message: "Asl PDF serverda qolmagan (server qayta ishga tushgan bo'lishi mumkin). Rejani qayta yuklang." });
    }
    const failed = await BookMaterial.find({ plan: plan._id, status: 'failed' }).sort({ plan_order: 1 });
    if (!failed.length) return res.status(409).json({ message: "Xato bo'lgan qism yo'q" });

    await BookMaterial.updateMany(
      { _id: { $in: failed.map((b) => b._id) } },
      { $set: { status: 'processing', started_at: new Date() }, $unset: { error_message: 1, error_detail: 1 } }
    );
    res.status(202).json({ retrying: failed.length });

    setImmediate(async () => {
      try {
        const srcDoc = await loadPdf(plan.original_path);
        for (const b of failed) {
          await enqueuePart({
            planDoc: plan,
            srcDoc,
            bookDoc: b,
            part: { section: b.section_title, from: b.source_pages.from, to: b.source_pages.to },
            level: plan.level,
          });
        }
      } catch (e) {
        console.error('Qayta urinish xatosi:', e);
        await BookMaterial.updateMany(
          { _id: { $in: failed.map((b) => b._id) }, status: 'processing' },
          { $set: { status: 'failed', error_message: 'PDF ni qayta kesib bo‘lmadi', finished_at: new Date() } }
        ).catch(() => {});
      }
    });
  } catch (error) {
    console.error('retryPlan xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/** DELETE /api/admin/book-plans/:id — reja, uning hamma to'plamlari (biriktirilganlari ham) va fayllari */
const deletePlan = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: 'Topilmadi' });
    const plan = await BookPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Topilmadi' });
    await BookMaterial.deleteMany({ plan: plan._id });
    await fsp.rm(path.join(PLANS_DIR, String(plan._id)), { recursive: true, force: true }).catch(() => {});
    if (plan.original_path) await fsp.unlink(plan.original_path).catch(() => {});
    await BookPlan.deleteOne({ _id: plan._id });
    res.status(200).json({ message: 'Reja o‘chirildi' });
  } catch (error) {
    console.error('deletePlan xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * GET /api/admin/course-map — 4 daraja, har birida kunlar: turi (regular/imtihon), biriktirilgan to'plamlar, reja bormi
 */
const courseMap = async (req, res) => {
  try {
    const books = await BookMaterial.find({ assigned_day: { $ne: null } }).select('title assigned_day status plan section_title').lean();
    const plans = await StudyPlan.find().select('day_number needs_content').lean();
    const byDay = new Map();
    for (const b of books) {
      if (!byDay.has(b.assigned_day)) byDay.set(b.assigned_day, []);
      byDay.get(b.assigned_day).push({ id: b._id, title: b.title });
    }
    const planDays = new Set(plans.filter((p) => !p.needs_content).map((p) => p.day_number));
    const levels = LEVELS.map((level) => {
      const { from, to } = levelRange(level);
      const days = [];
      for (let d = from; d <= to; d++) {
        days.push({ day: d, type: deriveLessonType(d), books: byDay.get(d) || [], has_plan: planDays.has(d) });
      }
      const regular = days.filter((x) => x.type === 'regular');
      return {
        level, label: LEVEL_LABELS[level], from, to, days,
        regular_total: regular.length,
        regular_with_books: regular.filter((x) => x.books.length).length,
      };
    });
    res.status(200).json({ levels });
  } catch (error) {
    console.error('courseMap xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = { createPlan, listPlans, getPlan, placePlan, retryPlan, deletePlan, courseMap, regularDaysOfLevel };
