/**
 * Butun kursni (646 kun) tayyor kontentdan bazaga joylaydi — AI ishlatilmaydi.
 *
 *   node scripts/seedAll.js [--admin "Enzo Academy"]
 *
 * Beginner  : EVIU 1-30-unit (har unit 2 kun)   Elementary: EVIU 31-60-unit (har unit 2 kun)
 * Pre-Int / Int / Upper-Int : Key Words for Fluency (1 bet = 1 kun)
 * Har kunda grammatika kartasi ham bor (mavzu 2 kunga). Imtihon kunlari: scripts/buildExams.js
 * Idempotent: qayta ishga tushirsa yangilaydi.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { seedPack } = require('../lib/bookSeed');
const { buildExams } = require('../lib/examBuilder');
const { seedVoa } = require('../lib/voaSeed');
const { seedReadings } = require('../lib/readingSeed');

const LAYOUT = [
  { pack: 'eviu-elementary', level: 'beginner', split: true, from: 1, to: 30 },
  { pack: 'eviu-elementary', level: 'elementary', split: true, from: 31, to: 60 },
  { pack: 'kw-preintermediate', level: 'pre-intermediate' },
  { pack: 'kw-intermediate', level: 'intermediate' },
  { pack: 'kw-upperintermediate', level: 'upper-intermediate' },
];

async function seedAll(uploader, log = console.log) {
  const out = [];
  for (const l of LAYOUT) {
    const r = await seedPack({ ...l, uploader });
    log(`${l.level}: ${r.sets} to'plam, ${r.placed.length} kunga joylandi, sig'magani ${r.overflow}`);
    out.push({ level: l.level, ...r });
  }
  await seedVoa(log);
  await seedReadings(log);
  const ex = await buildExams(log);
  return { levels: out, exams: ex };
}

module.exports = { LAYOUT, seedAll };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const ai = args.indexOf('--admin');
    await mongoose.connect(process.env.MONGO_URI);
    const admin = ai >= 0 ? await User.findOne({ name_key: User.nameKey(args[ai + 1]), role: 'admin' }) : await User.findOne({ role: 'admin' });
    if (!admin) { console.error('Admin topilmadi. Avval: node scripts/createAdmin.js'); process.exit(1); }
    await seedAll(admin._id);
    await mongoose.disconnect();
  })().catch((e) => { console.error(e); process.exit(1); });
}
