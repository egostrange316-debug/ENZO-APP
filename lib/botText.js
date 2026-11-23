/** Telegram xabarlari matni va ism qidirish (sof funksiyalar). Matn HTML formatida. */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "O'ktam", "Oktam", "oʻktam" bir xil bo'lsin; harf va raqamdan boshqasi olib tashlanadi */
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKC')
    .replace(/[ʻʼ'’`‘´]/g, '').replace(/[^a-z0-9Ѐ-ӿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Ism bo'yicha qidirish: to'liq mos -> birinchi; bo'lmasa har bir so'z ism so'zining boshi bo'lsa. Ko'pi bilan 8 ta. */
function matchStudents(query, students) {
  const q = normName(query);
  if (q.length < 3) return [];
  const qt = q.split(' ');
  const exact = [], part = [];
  for (const s of students) {
    const n = normName(s.full_name);
    if (n === q) { exact.push(s); continue; }
    const nt = n.split(' ');
    if (qt.every((t) => nt.some((x) => x.startsWith(t)))) part.push(s);
  }
  return (exact.length ? exact : part).slice(0, 8);
}

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';
const grp = (g) => (g ? ` (${esc(g)})` : '');
const fmtDate = (d) => {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d);
};

const T = {
  welcome:
    "🎓 <b>Enzo Academy</b> nazorat botiga xush kelibsiz!\n\n" +
    "Farzandingizning kunlik dars natijalari, davomat va to‘lov eslatmalarini shu yerda kuzatib borasiz.\n\n" +
    "👇 Ulash uchun farzandingizning <b>ism-familiyasini</b> yozing (masalan: <i>Ali Valiyev</i>):",
  notFound:
    "🔍 Bunday ism ro‘yxatda topilmadi.\nIsm-familiyani ro‘yxatdagidek to‘liq yozib ko‘ring yoki markaz ustoziga murojaat qiling.",
  tooMany:
    "⚠️ Ism ro‘yxatdan topilmadi. Iltimos, markaz ustoziga murojaat qiling — ustoz sizni qo‘lda ulab beradi.",
  pick: "🔍 <b>Qidiruv natijasi</b> — farzandingizni tanlang:",
  limit: "⚠️ Bu o‘quvchiga allaqachon 3 ta ota-ona ulangan. Qo‘shimcha ulash uchun ustozga murojaat qiling.",
  noKids: "ℹ️ Hali hech kim ulanmagan. Ulash uchun /start bosib farzandingiz ismini yozing.",
  linked: (n, g) =>
    `🎉 <b>Ulandi — ulanish tasdiqlandi!</b>\n\n` +
    `Endi <b>${esc(n)}</b>${grp(g)} ning kunlik dars natijalari va muhim xabarlari shu yerga kelib turadi.\n\n` +
    `📌 Buyruqlar:\n• /holat — bugungi holat\n• /bolalarim — ulangan o‘quvchilar\n• /uzish — botdan uzish`,
  unlinked: "🔌 Ulanish uzildi. Qayta ulash uchun /start ni bosing.",
  done: (n, g, streak = 0, dateStr = '') =>
    `🌟 <b>Kunlik hisobot${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `✅ <b>Holat:</b> Bugungi darsni bajardi!` +
    `${streak >= 2 ? `\n🔥 <b>Ketma-ketlik:</b> ${streak} kun uzluksiz` : ''}`,
  missed: (n, g, steps, row, dateStr = '') =>
    `📌 <b>Kunlik hisobot${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `❗️ <b>Holat:</b> Bugun dars qilmadi` +
    `${steps ? `\n📊 Darsdan ${steps} bosqich bajarilgan.` : ''}` +
    `${row > 1 ? `\n⚠️ Ketma-ket <b>${row} kun</b> dars o‘tkazildi.` : ''}\n\n` +
    `Quyidagi tugmalardan birini tanlashingiz mumkin:`,
  askExcuse: "✍️ Sababni yozib yuboring (masalan: <i>betob bo‘lib qoldi, oilaviy tadbir va h.k.</i>):",
  parentExcuseSent: "📨 Sababingiz ustozga yuborildi. Tasdiqlanishini kuting.",
  parentCallSent: "📞 So‘rovingiz qabul qilindi! Ustoz tez orada siz bilan bog‘lanadi.",
  excuseConfirmed: (n, dateStr = '') =>
    `✅ <b>Sabab tasdiqlandi</b> — ${esc(n)}${dateStr ? ` (${esc(fmtDate(dateStr))})` : ''}\nBugungi dars sababli deb belgilandi.`,
  excuseRejected: (n, dateStr = '') =>
    `❌ <b>Sabab rad etildi</b> — ${esc(n)}${dateStr ? ` (${esc(fmtDate(dateStr))})` : ''}\nBatafsil ma’lumot uchun ustoz bilan bog‘lanishingiz mumkin.`,
  status: (n, label, g) => `👤 <b>${esc(n)}</b>${grp(g)}\n${label}`,
  weekly: (n, w, g) =>
    `📊 <b>Haftalik hisobot</b> — ${esc(n)}${grp(g)}\n\n` +
    `📚 Darslar: <b>${w.done}/${w.lesson}</b> bajarildi${w.excused ? ` (+${w.excused} sababli)` : ''}\n` +
    `⭐ Ochko: <b>${w.points}</b>\n` +
    `🔥 Ketma-ket kunlar: <b>${w.streak}</b>` +
    `${w.extra ? `\n➕ Dam kunida ham o‘qigan: ${w.extra} kun` : ''}\n\n` +
    `${w.lesson && w.done === w.lesson ? '🏆 Barakalla! Hafta to‘liq bajarildi 👏' : w.missed ? `⚠️ O‘tkazilgan darslar: ${w.missed} ta. Keyingi haftada birga davom ettiramiz.` : '💪 Davom eting!'}`,
  payDue: (n, left, dueStr, fee, g) =>
    `🔔 <b>To‘lov eslatmasi</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `📅 <b>To‘lov sanasi:</b> ${esc(dueStr)} (${left <= 1 ? '1 kun qoldi' : `${left} kun qoldi`})` +
    `${fee ? `\n💰 <b>Oylik to‘lov:</b> ${esc(fee)} so‘m` : ''}\n\n` +
    `⚠️ To‘lov o‘z vaqtida amalga oshirilmasa, ilovadagi akkaunt avtomatik bloklanadi.`,
  payGrace: (n, left, dueStr, fee, g) =>
    `⏳ <b>To‘lov muddati o‘tdi</b> (${esc(dueStr)})\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `⚠️ Akkaunt bloklanmasligi uchun <b>${left} kun</b> ichida to‘lov qiling.` +
    `${fee ? `\n💰 <b>Oylik to‘lov:</b> ${esc(fee)} so‘m` : ''}`,
  accountBlocked: (n, g) =>
    `🔒 <b>Akkaunt vaqtincha bloklandi</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `⏳ <b>Sabab:</b> Oylik to‘lov muddati o‘tgan\n\n` +
    `Qayta faollashtirish uchun ustoz yoki markaz bilan bog‘laning.`,
  accountUnblocked: (n, g) =>
    `🔓 <b>Akkaunt qayta faollashtirildi!</b>\n\n` +
    `👤 <b>${esc(n)}</b>${grp(g)} endi ilovadan bemalol foydalanishi mumkin. ✅`,
  teacherId: (id) => `🆔 Sizning chat ID: <code>${esc(id)}</code>\nBu raqamni Render'da <code>TELEGRAM_TEACHER_IDS</code> ga yozing.`,
  teacherMissed: (group, rows, doneCount, excusedNames = [], dateStr = '', totalCount = 0) => {
    const total = totalCount || (doneCount + rows.length + excusedNames.length);
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const missedNames = rows.map((r) => `${esc(r.full_name)}${r.missed_in_row > 1 ? ` (${r.missed_in_row}k)` : ''}`);
    return (
      `📊 <b>Yakuniy kunlik hisobot${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}</b>\n\n` +
      `🏷 <b>${esc(group)}</b> (${total} nafar) — <b>${pct}%</b>\n` +
      `├ ✅ Bajardi: <b>${doneCount}</b>\n` +
      `├ 📝 Sababli: <b>${excusedNames.length}</b>${excusedNames.length ? ` (${excusedNames.map(esc).join(', ')})` : ''}\n` +
      `└ ❌ Bajarmadi: <b>${rows.length}</b>${missedNames.length ? ` (${missedNames.join(', ')})` : ''}`
    );
  },
  teacherRisk: (n, row, hasParent, g) =>
    `🚨 <b>XAVF OSTIDA — ${row} kun ketma-ket!</b>\n\n` +
    `🎓 <b>${esc(n)}</b>${grp(g)} ketma-ket <b>${row} ta</b> darsni bajarmadi.\n` +
    `Ota-onasi bilan shaxsan bog‘lanish tavsiya etiladi.${hasParent ? '' : '\n⚠️ Ota-onasi botga ulanmagan.'}`,
  teacherNewLink: (kid, who, g) =>
    `🆕 <b>Yangi ulanish</b>\n👨‍👩‍👧 <b>Kim:</b> ${esc(who)}\n🎓 <b>O‘quvchi:</b> ${esc(kid)}${grp(g)}`,
  teacherExcuse: (kid, text, g) =>
    `📝 <b>Tasdiq kerak — Ota-onadan sabab keldi</b>\n🎓 <b>O‘quvchi:</b> ${esc(kid)}${grp(g)}\n💬 <b>Izoh:</b> «${esc(text)}»`,
  teacherCall: (kid, g, who = '') =>
    `📞 <b>Bog‘lanish so‘rovi!</b>\n🎓 <b>O‘quvchi:</b> ${esc(kid)}${grp(g)}${who ? `\n👨‍👩‍👧 <b>Ota-ona:</b> ${esc(who)}` : ''}`,
};
const STATUS_LABEL = {
  done: '✅ Bugungi darsni bajardi',
  pending: '⏳ Hali bajarmadi (vaqt bor)',
  missed: '❌ Bugun dars qilmadi',
  excused: '📝 Sababli',
  off: '📅 Bugun dam / dars yo‘q',
};

module.exports = { esc, normName, matchStudents, firstName, fmtDate, T, STATUS_LABEL };
