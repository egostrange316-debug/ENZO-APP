const fs = require('fs/promises');
const { PDFDocument } = require('pdf-lib');

/** n ta sahifani d ta qismga bo'ladi: avvalgi qismlar 1 tadan ko'p oladi (7 sahifa/3 kun -> 3,2,2). */
function splitCounts(n, d) {
  const parts = Math.max(1, Math.min(d, n));
  const base = Math.floor(n / parts);
  const extra = n % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Reja bo'limlarini PDF sahifa oraliqlariga aylantiradi.
 * sections: [{title, from_page, to_page, days}] (KITOB sahifalari) -> [{section, part, parts, from, to}] (KITOB sahifalari)
 */
function planParts(sections) {
  const out = [];
  for (const sec of sections) {
    const n = sec.to_page - sec.from_page + 1;
    const counts = splitCounts(n, sec.days);
    let cur = sec.from_page;
    counts.forEach((c, i) => {
      out.push({ section: sec.title, part: i + 1, parts: counts.length, from: cur, to: cur + c - 1 });
      cur += c;
    });
  }
  return out;
}

async function loadPdf(filePath) {
  const bytes = await fs.readFile(filePath);
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/** Manba PDF dan [from..to] (1-dan boshlanadigan PDF sahifalari) ni alohida PDF fayl qilib yozadi */
async function writeRange(srcDoc, fromPdfPage, toPdfPage, destPath) {
  const out = await PDFDocument.create();
  const idx = [];
  for (let p = fromPdfPage; p <= toPdfPage; p++) idx.push(p - 1);
  const pages = await out.copyPages(srcDoc, idx);
  pages.forEach((pg) => out.addPage(pg));
  await fs.writeFile(destPath, await out.save());
}

module.exports = { splitCounts, planParts, loadPdf, writeRange };
