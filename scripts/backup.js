// Bazaning to'liq zaxirasi (JSON). Ishlatish (backend papkasida, cmd):
//   set "MONGO_URI=<Render > Environment dagi MONGO_URI ni nusxalang>"
//   node scripts/backup.js
// Natija: zaxira/<sana-vaqt>/<kolleksiya>.json  — BU PAPKANI HECH KIMGA YUBORMANG (parol xeshlari bor).
// Tiklash: node scripts/restore.js zaxira/<papka>   (faqat BO'SH kolleksiyalarga yozadi)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI kerak'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = path.join('zaxira', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const cols = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  let total = 0;
  for (const name of cols) {
    const docs = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(dir, name + '.json'), EJSON.stringify(docs, { relaxed: false }));
    console.log(String(docs.length).padStart(6), name);
    total += docs.length;
  }
  console.log(`Tayyor: ${total} ta yozuv -> ${dir}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
