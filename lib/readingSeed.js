/**
 * Qo'shimcha o'qish matnlarini (CEFR/IELTS uslubida, original) mavzusiga mos kunga joylaydi.
 * content/reading-extra/<daraja>.json: har matnda `target` (to'plam seed_key'i, masalan "eviu-elementary:u4b").
 * Idempotent: avval barcha eski `readings` tozalanadi, keyin qayta yoziladi.
 */
const fs = require('fs');
const path = require('path');
const BookMaterial = require('../models/BookMaterial');

const LEVELS = ['beginner', 'elementary', 'pre-intermediate', 'intermediate', 'upper-intermediate'];

async function seedReadings(log = console.log) {
  await BookMaterial.updateMany({ readings: { $exists: true, $ne: [] } }, { $set: { readings: [] } });
  let total = 0;
  for (const level of LEVELS) {
    const file = path.join(__dirname, '..', 'content', 'reading-extra', `${level}.json`);
    if (!fs.existsSync(file)) continue;
    const passages = JSON.parse(fs.readFileSync(file, 'utf8'));
    let placed = 0;
    for (const { target, ...passage } of passages) {
      const r = await BookMaterial.updateOne({ seed_key: target }, { $push: { readings: passage } });
      if (r.matchedCount) placed++; else log(`Reading+: ${target} topilmadi (${passage.title})`);
    }
    log(`Reading+ ${level}: ${placed}/${passages.length} matn joylandi`);
    total += placed;
  }
  return total;
}
module.exports = { seedReadings };
