/**
 * Supabase (Postgres) -> MongoDB ko'chirish.
 *
 *   node scripts/migrateFromSupabase.js                 # QURUQ ISHLASH: faqat nima bo'lishini ko'rsatadi
 *   node scripts/migrateFromSupabase.js --commit        # haqiqatan yozadi
 *   node scripts/migrateFromSupabase.js --commit --sub-days 30 --group-map groupmap.json
 *
 * .env: MONGO_URI, SUPABASE_URL, SUPABASE_KEY (anon yoki service_role)
 *
 * Nimalar ko'chadi:
 *   students                  -> User   (parollar bcrypt bilan HASH qilinadi; eski ochiq parollar ishlayveradi)
 *   vocab_files+vocab+ai_exercises -> StudyPlan (kunlarga joylanadi; lug'at, test, bo'sh joy to'ldirish)
 * Nimalar ko'chmaydi (hozircha Supabase'da qoladi): chat, uy vazifasi, davomat/to'lov jurnali,
 *   vocab_history, file_progress, IELTS/CEFR speaking/writing, pronunciation_history.
 *
 * Qayta ishga tushirish XAVFSIZ: mavjud o'quvchining current_day/status/muddati o'zgarmaydi,
 * ko'chirilgan fayllar o'z kunini saqlaydi.
 */
require('dotenv').config();
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');
const { mapStudent, planMigration, DEFAULT_GROUP_TO_LEVEL } = require('./lib/transform');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COMMIT = flag('--commit');
const SUB_DAYS = Number(opt('--sub-days', 30));

async function fetchTable(table) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const headers = { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` };
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${base}/rest/v1/${table}?select=*&order=created_at.asc`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

(async () => {
  for (const k of ['MONGO_URI', 'SUPABASE_URL', 'SUPABASE_KEY']) {
    if (!process.env[k]) { console.error(`.env ichida ${k} yo'q`); process.exit(1); }
  }
  const groupToLevel = opt('--group-map') ? JSON.parse(fs.readFileSync(opt('--group-map'), 'utf8')) : DEFAULT_GROUP_TO_LEVEL;

  console.log(COMMIT ? '=== HAQIQIY YOZISH ===' : '=== QURUQ ISHLASH (hech narsa yozilmaydi; --commit bilan yozing) ===');

  const [students, files, vocab, aiExercises] = await Promise.all([
    fetchTable('students'), fetchTable('vocab_files'), fetchTable('vocab'), fetchTable('ai_exercises'),
  ]);
  console.log(`Supabase: ${students.length} o'quvchi, ${files.length} fayl, ${vocab.length} so'z, ${aiExercises.length} AI mashq`);

  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User.init(), StudyPlan.init()]); // indekslar tayyor bo'lsin

  // ---------- O'quvchilar ----------
  const stu = { created: 0, existed: 0, failed: [] };
  for (const row of students) {
    if (!row.password) { stu.failed.push(`${row.full_name}: paroli yo'q`); continue; }
    if (await User.exists({ legacy_id: row.id })) { stu.existed++; continue; }
    const doc = mapStudent(row, { subDays: SUB_DAYS });
    if (!COMMIT) { stu.created++; continue; }
    try {
      doc.password_hash = await bcrypt.hash(String(row.password), 10);
      await User.create(doc);
      stu.created++;
    } catch (e) {
      stu.failed.push(`${row.full_name}: ${e.code === 11000 ? 'bu ism Mongo\'da allaqachon bor' : e.message}`);
    }
  }
  console.log(`O'quvchilar: ${stu.created} ${COMMIT ? "ko'chirildi" : "ko'chiriladi"}, ${stu.existed} avvaldan bor, ${stu.failed.length} xato`);
  stu.failed.forEach((f) => console.log('   !', f));

  // ---------- Darslar ----------
  const existingPlans = await StudyPlan.find({}).select('day_number legacy_file_id').lean();
  const { plans, finalPlaceholders, skipped, errors } = planMigration({
    files, vocab, aiExercises, existingPlans, groupToLevel,
  });

  console.log(`Darslar: ${plans.length} ta kun ${COMMIT ? 'yoziladi' : 'yoziladi (quruq)'}, ${finalPlaceholders.length} ta final_exam o'rni, ${skipped.length} ta o'tkazib yuborildi`);
  plans.forEach((p) => console.log(`   ${String(p.day_number).padStart(3)}-kun [${p.level} / ${p.lesson_type}] ${p.unit_title}  (${p.vocabulary.length} so'z, ${p.quizzes.length} test, ${p.fill_in_the_blanks.length} bo'sh joy)`));
  skipped.forEach((s) => console.log(`   - o'tkazildi: ${s.file} — ${s.reason}`));
  errors.forEach((e) => console.log(`   ! ${e}`));

  if (COMMIT) {
    for (const p of [...plans, ...finalPlaceholders]) {
      await StudyPlan.updateOne({ day_number: p.day_number }, { $setOnInsert: p }, { upsert: true });
    }
  }

  await mongoose.disconnect();
  console.log(COMMIT ? 'Tayyor.' : "\nQuruq ishlash tugadi. Hammasi to'g'ri ko'rinsa: --commit bilan qayta ishga tushiring.");
})().catch((e) => { console.error(e); process.exit(1); });
