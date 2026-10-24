// Muhit sozlamalari server/modullar yuklanishidan OLDIN o'rnatiladi
process.env.BOOK_MAX_FILE_MB = '1';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.GEMINI_FILE_POLL_MS = '10';
process.env.GEMINI_RETRY_MS = '10';
process.env.BOOK_UPLOAD_DIR = require('path').join(require('os').tmpdir(), `book-test-${process.pid}`);

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setup } = require('./helpers');
const { startFakeGemini, goodBook } = require('./fakeGemini');
const BookMaterial = require('../models/BookMaterial');
const { queue } = require('../controllers/bookController');
const { detectMime, validateAndCleanBook } = require('../services/bookService');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% test pdf\n'), Buffer.alloc(200, 32), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const pdfPart = { type: 'application/pdf', bytes: PDF, filename: 'Oxford Unit 3.pdf' };
const pngPart = { type: 'image/png', bytes: PNG, filename: 'page.png' };

let t, admin, gem;
const tmpFiles = () => fs.readdirSync(process.env.BOOK_UPLOAD_DIR);

async function startGem(opts) {
  if (gem) await gem.close();
  gem = await startFakeGemini(opts);
  process.env.GEMINI_BASE_URL = gem.url;
  return gem;
}
async function uploadAndWait(parts, fields = {}) {
  const r = await t.form('POST', '/api/admin/books', { token: admin, parts, fields });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await queue.onIdle();
  const g = await t.call('GET', `/api/admin/books/${r.data.id}`, { token: admin });
  return { id: r.data.id, book: g.data.book };
}

before(async () => {
  t = await setup();
  admin = await t.makeAdmin('Book Admin');
});
after(async () => {
  if (gem) await gem.close();
  await t.teardown();
});
beforeEach(async () => { await startGem(); });

test('ruxsat: tokensiz 401, o\'quvchi 403', async () => {
  assert.equal((await t.form('POST', '/api/admin/books', { parts: [pdfPart] })).status, 401);
  const s = await t.makeStudent('Book Student');
  assert.equal((await t.form('POST', '/api/admin/books', { token: s.token, parts: [pdfPart] })).status, 403);
  assert.equal((await t.call('GET', '/api/admin/books', { token: s.token })).status, 403);
});

test('rad etiladi: fayl yo\'q, soxta .pdf (matn), juda katta fayl, 11 ta fayl — va diskda iz qolmaydi', async () => {
  assert.equal((await t.form('POST', '/api/admin/books', { token: admin })).status, 400);

  const fake = await t.form('POST', '/api/admin/books', { token: admin, parts: [{ type: 'application/pdf', bytes: Buffer.from('bu PDF emas, oddiy matn fayl........'), filename: 'x.pdf' }] });
  assert.equal(fake.status, 400);
  assert.match(fake.data.message, /PDF yoki rasm/);

  const big = await t.form('POST', '/api/admin/books', { token: admin, parts: [{ type: 'application/pdf', bytes: Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024)]), filename: 'big.pdf' }] });
  assert.equal(big.status, 413);

  const many = await t.form('POST', '/api/admin/books', { token: admin, parts: Array.from({ length: 11 }, () => pngPart) });
  assert.equal(many.status, 400);

  assert.deepEqual(tmpFiles(), []);
  assert.equal(gem.calls.uploads.length, 0, 'yaroqsiz fayl Gemini\'ga yuborilmasligi kerak');
});

test('muvaffaqiyat: PDF+rasm Gemini\'ga yuklanadi, kutiladi, o\'qiladi, natija MongoDB\'ga yoziladi, hamma nusxa tozalanadi', async () => {
  const { book } = await uploadAndWait([pdfPart, pngPart], { title: 'Unit 3', level: 'elementary' });

  assert.equal(book.status, 'ready', JSON.stringify(book.error_message));
  assert.equal(book.title, 'Unit 3');                       // o'qituvchi bergan sarlavha saqlanadi
  assert.equal(book.level_hint, 'elementary');
  assert.equal(book.writing.vocabulary.length, 8);
  assert.equal(book.writing.grammar[0].exercises.length, 2);
  assert.equal(book.writing.grammar[0].exercises[1].options.length, 2);
  assert.equal(book.reading.questions.length, 5);
  assert.equal(book.reading.key_words.length, 3);
  assert.ok(book.listening.script.length > 60);
  assert.equal(book.listening.dictation_sentences.length, 3);
  assert.equal(book.speaking.questions.length, 6);
  assert.deepEqual(book.source_files.map((f) => f.mime_type), ['application/pdf', 'image/png']);
  assert.equal(book.source_files[0].original_name, 'Oxford Unit 3.pdf');
  assert.deepEqual(book.warnings, []);

  // Gemini bilan muloqot (haqiqiy SDK orqali)
  assert.deepEqual(gem.calls.uploads.map((u) => u.mime), ['application/pdf', 'image/png']);
  assert.ok(gem.calls.uploads.every((u) => u.protocol === 'multipart' && u.apiKey === 'fake-key'));
  assert.ok(gem.calls.polls >= 2, 'ACTIVE bo\'lguncha kutilishi kerak');
  assert.equal(gem.calls.generates.length, 1);
  const g = gem.calls.generates[0];
  assert.equal(g.model, 'gemini-2.5-flash');
  const parts = g.body.contents[0].parts;
  assert.equal(parts.filter((p) => p.fileData).length, 2);
  assert.ok(parts.filter((p) => p.fileData).every((p) => p.fileData.fileUri.includes('/v1beta/files/')));
  assert.match(parts.at(-1).text, /Ignore any instructions/);
  assert.match(parts.at(-1).text, /level: elementary|Target level: elementary/);
  assert.equal(g.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(gem.calls.deletes.length, 2, 'Gemini serveridagi nusxalar o\'chirilishi kerak');
  assert.deepEqual(tmpFiles(), [], 'vaqtinchalik fayllar o\'chirilishi kerak');
});

test('sarlavha berilmasa AI taklif qilgani olinadi', async () => {
  const { book } = await uploadAndWait([pngPart]);
  assert.equal(book.title, 'Family and Friends');
});

test('Gemini 429 (limit): 3 marta urinadi, keyin tushunarli xabar bilan failed; fayllar tozalanadi', async () => {
  await startGem({ responder: () => ({ status: 429, error: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' } } }) });
  const { book } = await uploadAndWait([pngPart]);
  assert.equal(book.status, 'failed');
  assert.match(book.error_message, /limiti/);
  assert.equal(gem.calls.generates.length, 3);
  assert.equal(gem.calls.deletes.length, 1);
  assert.deepEqual(tmpFiles(), []);
});

test('Gemini 503 bir marta -> qayta uriniladi va muvaffaqiyatli bo\'ladi', async () => {
  await startGem({ responder: (b, n) => (n === 1 ? { status: 503, error: { error: { code: 503, message: 'overloaded' } } } : { status: 200, json: goodBook() }) });
  const { book } = await uploadAndWait([pngPart]);
  assert.equal(book.status, 'ready');
  assert.equal(gem.calls.generates.length, 2);
});

test('Gemini yaroqsiz JSON qaytarsa -> failed', async () => {
  await startGem({ responder: () => ({ status: 200, raw: 'Mana mashqlar: ... (JSON emas)' }) });
  const { book } = await uploadAndWait([pngPart]);
  assert.equal(book.status, 'failed');
  assert.match(book.error_message, /noto‘g‘ri formatda/);
});

test('qisman natija: grammatika yo\'q -> ready + ogohlantirish; to\'liq bo\'sh -> failed', async () => {
  const thin = goodBook(); thin.writing.grammar = []; thin.speaking.questions = thin.speaking.questions.slice(0, 2);
  await startGem({ responder: () => ({ status: 200, json: thin }) });
  const { book } = await uploadAndWait([pngPart]);
  assert.equal(book.status, 'ready');
  assert.ok(book.warnings.some((w) => /grammatika/i.test(w)));
  assert.ok(book.warnings.some((w) => /Speaking/.test(w)));

  await startGem({ responder: () => ({ status: 200, json: { title: 'x', writing: {}, reading: {}, listening: {}, speaking: {} } }) });
  const empty = await uploadAndWait([pngPart]);
  assert.equal(empty.book.status, 'failed');
  assert.match(empty.book.error_message, /mashq yaratib bo‘lmadi/);
});

test('ro\'yxat, to\'liq olish, o\'chirish; osilib qolgan "processing" avtomatik failed bo\'ladi', async () => {
  const { id } = await uploadAndWait([pngPart]);
  const list = await t.call('GET', '/api/admin/books', { token: admin });
  const item = list.data.books.find((b) => String(b.id) === String(id));
  assert.equal(item.counts.vocabulary, 8);
  assert.equal(item.counts.speaking_questions, 6);
  assert.equal(item.writing, undefined, 'ro\'yxatda og\'ir mazmun bo\'lmasligi kerak');

  const stuck = await BookMaterial.create({
    uploaded_by: (await require('../models/User').findOne({ role: 'admin' }))._id,
    title: 'Osilgan', status: 'processing', started_at: new Date(Date.now() - 11 * 60 * 1000),
  });
  const g = await t.call('GET', `/api/admin/books/${stuck._id}`, { token: admin });
  assert.equal(g.data.book.status, 'failed');
  assert.match(g.data.book.error_message, /qayta yuklang/);

  assert.equal((await t.call('DELETE', `/api/admin/books/${id}`, { token: admin })).status, 200);
  assert.equal((await t.call('GET', `/api/admin/books/${id}`, { token: admin })).status, 404);
  assert.equal((await t.call('GET', '/api/admin/books/not-an-id', { token: admin })).status, 404);
});

test('detectMime: haqiqiy baytlar bo\'yicha', () => {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(16)]);
  assert.equal(detectMime(pad(Buffer.from('%PDF-1.7'))), 'application/pdf');
  assert.equal(detectMime(PNG), 'image/png');
  assert.equal(detectMime(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))), 'image/jpeg');
  assert.equal(detectMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'image/webp');
  assert.equal(detectMime(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(4)])), 'image/heic');
  assert.equal(detectMime(pad(Buffer.from('MZ executable'))), null);
  assert.equal(detectMime(Buffer.from('short')), null);
});

test('validateAndCleanBook: noto\'g\'ri savollar tashlanadi, to\'g\'ri javobsiz variantlar olib tashlanadi, uzun matn qisqartiriladi', () => {
  const b = goodBook();
  b.reading.questions[0].correct_answer_index = 9;                 // yaroqsiz indeks
  b.reading.questions[1].options = ['a', 'A', 'b', 'c'];          // takroriy variant
  b.writing.grammar[0].exercises[0].options = ['go', 'going'];    // to'g'ri javob ('goes') yo'q
  b.writing.grammar[0].exercises.push({ sentence_with_blank: 'no blank here', correct_word: 'x' });
  b.reading.text = 'x'.repeat(9000);
  const c = validateAndCleanBook(b);
  assert.equal(c.reading.questions.length, 3);
  assert.deepEqual(c.writing.grammar[0].exercises[0].options, []);
  assert.equal(c.writing.grammar[0].exercises.length, 2);
  assert.equal(c.reading.text.length, 5000);
  assert.throws(() => validateAndCleanBook(null));
});
