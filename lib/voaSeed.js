/**
 * Tashqi ochiq manba (VOA Learning English) darslarini mavjud to'plamlarga qo'shadi.
 * content/voa/lessons.json: [{ seed_key, title, audio_url, credit, source_url, transcript, questions }]
 * Idempotent. Faqat `voa` maydoniga tegadi (o'quvchi natijalari saqlanadi).
 */
const fs = require('fs');
const path = require('path');
const BookMaterial = require('../models/BookMaterial');

async function seedVoa(log = console.log) {
  const file = path.join(__dirname, '..', 'content', 'voa', 'lessons.json');
  if (!fs.existsSync(file)) return 0;
  const lessons = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const l of lessons) {
    const { seed_key, ...voa } = l;
    const r = await BookMaterial.updateOne({ seed_key }, { $set: { voa } });
    if (r.matchedCount) n++; else log(`VOA: ${seed_key} topilmadi`);
  }
  log(`VOA: ${n} ta dars qo'shildi`);
  return n;
}
module.exports = { seedVoa };
