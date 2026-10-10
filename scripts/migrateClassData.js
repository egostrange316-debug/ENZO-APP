/**
 * Supabase'dagi sinf ma'lumotlarini (davomat, uy vazifasi, topshiriqlar, xabarlar) MongoDB'ga ko'chiradi.
 *
 *   node scripts/migrateClassData.js            # quruq ishlash
 *   node scripts/migrateClassData.js --commit   # yozadi
 *
 * Avval `migrateFromSupabase.js --commit` bilan o'quvchilar ko'chirilgan bo'lishi kerak (legacy_id bo'yicha bog'lanadi).
 * .env: MONGO_URI, SUPABASE_URL, SUPABASE_KEY
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { importClassData } = require('./lib/classImport');

const COMMIT = process.argv.includes('--commit');

async function fetchTable(table) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const headers = { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` };
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/${table}?select=*`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
}

(async () => {
  for (const k of ['MONGO_URI', 'SUPABASE_URL', 'SUPABASE_KEY']) if (!process.env[k]) { console.error(`.env ichida ${k} yo'q`); process.exit(1); }
  console.log(COMMIT ? '=== HAQIQIY YOZISH ===' : "=== QURUQ ISHLASH (--commit bilan yozing) ===");
  const [attendance, homework, submissions, messages] = await Promise.all(['attendance', 'homework', 'homework_submissions', 'messages'].map(fetchTable));
  await mongoose.connect(process.env.MONGO_URI);
  const rep = await importClassData({ attendance, homework, submissions, messages }, { commit: COMMIT });
  for (const [k, v] of Object.entries(rep)) console.log(`${k}: ${v.ok} ta ${COMMIT ? "ko'chirildi" : "ko'chiriladi"}, ${v.skipped} ta o'tkazib yuborildi (o'quvchisi yo'q yoki ma'lumot to'liq emas)`);
  console.log("Eslatma: avatar va uy vazifasi rasmlari eski Supabase Storage havolalari bilan qoladi — Supabase loyihasini rasmlar ko'chirilmaguncha o'chirmang.");
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
