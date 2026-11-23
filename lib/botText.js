/** Telegram xabarlari matni va ism qidirish (sof funksiyalar). Matn HTML formatida. */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "O'ktam", "Oktam", "oʻktam" bir xil bo'lsin; harf va raqamdan boshqasi olib tashlanadi */
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKC')
    .replace(/[ʻʼ'’`‘´]/g, '').replace(/[^a-z0-9Ѐ-ӿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Ism bo'yicha qidirish: to'liq mos → birinchi; bo'lmasa har bir so'z ism so'zining boshi bo'lsa. Ko'pi bilan 8 ta. */
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

const T = {
  welcome: "Assalomu alaykum! Bu <b>Enzo Academy</b> boti.\n\nFarzandingizning kunlik dars natijasini shu yerda ko'rasiz.\n\nBog'lanish uchun farzandingizning <b>ism-familiyasini</b> yozing (masalan: Ali Valiyev).",
  notFound: "Bunday ism ro'yxatda topilmadi. Ism-familiyani ro'yxatdagidek yozib ko'ring yoki ustozga murojaat qiling.",
  tooMany: "Ism topilmadi. Iltimos, ustozga murojaat qiling — ustoz sizni qo'lda ulaydi.",
  pick: "Farzandingizni tanlang:",
  limit: "Bu o'quvchiga allaqachon 3 ta ota-ona ulangan. Ustozga murojaat qiling.",
  noKids: "Hali hech kim ulanmagan. Ism-familiyani yozing.",
  linked: (n) => `✅ Ulandi: <b>${esc(n)}</b>.\nEndi dars natijasi shu yerga keladi.\n\nBuyruqlar: /holat — bugungi holat, /bolalarim — ulanganlar, /uzish — ajratish.`,
  unlinked: "Ajratildi. Qayta ulash uchun /start.",
  done: (n, tag) => `✅ <b>${esc(firstName(n))}</b> bugungi darsni bajardi${tag ? `\n${esc(tag)}` : ''}`,
  missed: (n, steps, row) => `📩 <b>${esc(firstName(n))}</b> bugun dars qilmadi.\n${steps ? `Darsdan ${steps} bosqich bajarilgan.` : "Dars hali boshlanmagan."}${row > 1 ? `\n${row} dars ketma-ket o'tkazildi.` : ''}\nIltimos, farzandingiz bilan gaplashib, ertaga darsni davom ettirishini so'rang.`,
  parentExcuseSent: "Rahmat. Xabaringiz ustozga yuborildi, tasdiqlansa bugungi dars hisoblanmaydi.",
  parentCallSent: "Ustozga xabar yuborildi, siz bilan bog'lanadi.",
  excuseConfirmed: (n) => `✅ ${esc(firstName(n))}: bugungi dars sababli deb tasdiqlandi.`,
  excuseRejected: (n) => `${esc(firstName(n))}: sabab tasdiqlanmadi. Ustoz siz bilan bog'lanishi mumkin.`,
  status: (n, label) => `<b>${esc(n)}</b>: ${label}`,
  weekly: (n, w) => `📊 <b>${esc(firstName(n))}</b> — haftalik hisobot\n\n📚 Darslar: <b>${w.done}/${w.lesson}</b> bajarildi${w.excused ? ` (+${w.excused} sababli)` : ''}\n⭐ Ochko: <b>${w.points}</b>\n🔥 Ketma-ket kunlar: <b>${w.streak}</b>${w.extra ? `\n➕ Dam kunida ham o'qigan: ${w.extra} kun` : ''}\n\n${w.lesson && w.done === w.lesson ? "Barakalla! Hafta to'liq bajarildi 👏" : w.missed ? `O'tkazilgan darslar: ${w.missed} ta. Keyingi haftada birga davom ettiramiz.` : "Davom eting!"}`,
  payDue: (n, left, dueStr, fee) => `💳 <b>${esc(firstName(n))}</b>: oylik to'lov kuni yaqin\n${left <= 1 ? 'Ertaga' : left + ' kundan keyin'} (${esc(dueStr)})${fee ? `\nOylik summa: ${esc(fee)} so'm` : ''}\nTo'lovni ustozga bildiring. Rahmat!`,
  payGrace: (n, left, dueStr, fee) => `💳 <b>${esc(firstName(n))}</b>: to'lov muddati o'tdi (${esc(dueStr)})\nDarslar yopilmasligi uchun ${left} kun ichida to'lov qiling.${fee ? `\nOylik summa: ${esc(fee)} so'm` : ''}`,
  teacherId: (id) => `Sizning chat ID: <code>${esc(id)}</code>\nBu raqamni Render'da TELEGRAM_TEACHER_IDS ga yozing.`,
  teacherMissed: (group, rows, doneCount) => `⚠️ <b>${esc(group)}</b> · dars bajarilmadi (muddat o'tdi):\n${rows.map((r) => `• ${esc(r.full_name)}: ${r.steps_done ? r.steps_done + ' bosqich' : 'boshlamagan'}${r.missed_in_row > 1 ? ` (${r.missed_in_row} kun ketma-ket)` : ''}`).join('\n')}\n\nBajarganlar: ${doneCount} ta`,
  teacherRisk: (n, row, hasParent) => `🔴 <b>Xavf ostida</b>\n${esc(n)} ${row} dars ketma-ket qilmayapti.${hasParent ? '' : ' Ota-onasi botga ulanmagan.'}`,
  teacherNewLink: (kid, who) => `🔗 Yangi ulanish: <b>${esc(kid)}</b> ← ${esc(who)}.\nBu sizning o'quvchingizning ota-onasimi?`,
  teacherExcuse: (kid, text) => `🟡 <b>Tasdiq kerak</b>\n${esc(kid)} uchun ota-ona yozdi: «${esc(text)}»`,
  teacherCall: (kid) => `📞 ${esc(kid)}ning ota-onasi ustoz bog'lanishini so'radi.`,
};
const STATUS_LABEL = { done: '✅ bugungi darsni bajardi', pending: '⏳ hali bajarmadi, vaqt bor', missed: '🔴 bugun bajarmadi', excused: '🟣 sababli', off: '– bugun dars yo\'q' };

module.exports = { esc, normName, matchStudents, firstName, T, STATUS_LABEL };
