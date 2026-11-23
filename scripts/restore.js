// Zaxiradan tiklash: node scripts/restore.js zaxira/<papka>   (MONGO_URI kerak)
// Xavfsizlik: faqat BO'SH kolleksiyalarga yozadi; to'la kolleksiyani o'tkazib yuboradi (ustiga yozmaydi).
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;
const dir = process.argv[2];
(async () => {
  if (!process.env.MONGO_URI || !dir || !fs.existsSync(dir)) { console.error('Ishlatish: set MONGO_URI=... && node scripts/restore.js zaxira/<papka>'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const name = f.slice(0, -5);
    const docs = EJSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!docs.length) continue;
    if (await db.collection(name).countDocuments({}, { limit: 1 })) { console.log('O\'TKAZILDI (bo\'sh emas):', name); continue; }
    await db.collection(name).insertMany(docs);
    console.log('Tiklandi:', name, docs.length);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
