/**
 * Tayyor kitob kontentini (AI'siz) bazaga yuklaydi va daraja kunlariga joylaydi.
 *
 *   node scripts/seedBook.js eviu-elementary elementary [--split] [--from N --to M] [--admin "Enzo Academy"]
 *
 * Idempotent: qayta ishga tushirsa natijani yangilaydi (dublikat yaratmaydi).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { seedPack } = require('../lib/bookSeed');

(async () => {
  const args = process.argv.slice(2);
  const split = args.includes('--split');
  const num = (f) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : null; };
  const from = num('--from');
  const to = num('--to');
  const ai = args.indexOf('--admin');
  const adminName = ai >= 0 ? args[ai + 1] : null;
  const [pack, level] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--admin' && args[i - 1] !== '--from' && args[i - 1] !== '--to');
  if (!pack || !level) { console.error('Foydalanish: node scripts/seedBook.js <paket> <daraja> [--split] [--from N --to M] [--admin "<ism>"]'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const admin = adminName ? await User.findOne({ name_key: User.nameKey(adminName), role: 'admin' }) : await User.findOne({ role: 'admin' });
  if (!admin) { console.error('Admin topilmadi. Avval: node scripts/createAdmin.js'); process.exit(1); }
  const r = await seedPack({ pack, level, uploader: admin._id, split, from, to });
  console.log(`${r.sets} ta to'plam, ${r.placed.length} tasi kunlarga joylandi (${r.free_days} bo'sh kun), sig'magani: ${r.overflow}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
