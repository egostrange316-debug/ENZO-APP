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

function formatFocusBlock(focus) {
  if (!focus) return '';
  const lines = ['\n\n⏱ <b>Vaqt va Diqqat tahlili:</b>'];
  if (!focus.usage_access) {
    lines.push('• ⚠️ Telefonda ota-ona nazorati (Usage Access) ruxsati o‘chirilgan');
    if (focus.left_count > 0) lines.push(`• 🔄 Darsdan chiqib ketish: <b>${focus.left_count} marta</b>`);
    return lines.join('\n');
  }
  lines.push(`• 📚 Enzo Academy: <b>${focus.study_minutes || 0} daqiqa</b>`);
  if ((focus.games_minutes || 0) > 0) {
    const gList = (focus.top_games || []).slice(0, 3).map((x) => `${esc(x.name)} (${x.minutes} daq)`).join(', ');
    lines.push(`• 🎮 O‘yinlar: <b>${focus.games_minutes} daqiqa</b>${gList ? ` — ${gList}` : ''}`);
  }
  if ((focus.other_apps_minutes || 0) > 0) {
    const aList = (focus.top_apps || []).slice(0, 3).map((x) => `${esc(x.name)} (${x.minutes} daq)`).join(', ');
    lines.push(`• 📱 Boshqa ilovalar: <b>${focus.other_apps_minutes} daqiqa</b>${aList ? ` — ${aList}` : ''}`);
  }
  if ((focus.left_count || 0) > 0) {
    lines.push(`• 🔄 Darsdan chiqib ketish: <b>${focus.left_count} marta</b>`);
  }
  const sc = typeof focus.focus_score === 'number' ? focus.focus_score : 100;
  const badge = sc >= 85 ? 'A’lo 🌟' : sc >= 65 ? 'Yaxshi 👍' : 'E’tibor talab ⚠️';
  lines.push(`• 🎯 Diqqat bahosi: <b>${sc}%</b> (${badge})`);
  return lines.join('\n');
}

const DINNER_QUIZ_POOL = [
  { q: '«Men fikringizga qo‘shilaman» inglizchada nima bo‘ladi?', a: 'I agree with you ("I am agree" emas!)' },
  { q: '«Kecha maktabga bormadim» inglizchada qanday aytiladi?', a: "I didn't go to school yesterday (\"didn't went\" emas!)" },
  { q: '«Juda muhim» so‘zining chiroyli inglizcha sinonimi?', a: 'Crucial / Vital / Essential' },
  { q: '«Menga yordam bera olasizmi?» xushmuomala shakli?', a: 'Could you help me, please?' },
  { q: '«Ular hozir dars qilishyapti» inglizchada?', a: 'They are studying right now' },
  { q: '«Soat necha bo‘ldi?» inglizchada qanday so‘raladi?', a: 'What time is it?' },
  { q: '«Men ingliz tilini yaxshi ko‘raman» inglizchada?', a: 'I love learning English' },
  { q: '«Ertaga nima qilmoqchisan?» inglizchada?', a: 'What are you going to do tomorrow?' },
  { q: '«Mening orzuyim» inglizchada nima?', a: 'My dream' },
  { q: '«Charchadim» so‘zining kuchli inglizcha varianti?', a: "I'm exhausted (juda charchadim)" },
  { q: '«Bu menga bog‘liq» inglizchada qanday aytiladi?', a: 'It depends on me ("depends of" emas!)' },
  { q: '«Kechirasiz, kechikdim» inglizchada?', a: "Sorry, I'm late" },
  { q: '«Menga suv bering, iltimos» xushmuomala shakli?', a: 'Could I have some water, please?' },
  { q: '«Bugun ob-havo qanday?» inglizchada?', a: "What's the weather like today?" },
  { q: '«Men hali tayyor emasman» inglizchada?', a: "I'm not ready yet" },
  { q: '«Osh bo‘lsin!» / «Yoqimli ishtaha!» inglizchada?', a: 'Enjoy your meal!' },
  { q: '«Qayerda yashaysiz?» inglizchada?', a: 'Where do you live?' },
  { q: '«Menga yoqdi» inglizchada?', a: 'I liked it / I enjoyed it' },
  { q: '«Muammo yo‘q, arzimaydi» inglizchada?', a: "No problem / You're welcome" },
  { q: '«Qo‘lingdan keladi!» (ruhlantirish) inglizchada?', a: 'You can do it!' },
];

function pickDinnerQuiz(seedStr = '') {
  let h = 0;
  const s = String(seedStr || 'enzo');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DINNER_QUIZ_POOL[h % DINNER_QUIZ_POOL.length];
}

function formatDinnerQuizBlock(seedStr) {
  const item = pickDinnerQuiz(seedStr);
  return (
    `\n\n🗣 <b>Kechki ovqatda 1 ta savol (tekshirib ko‘ring):</b>\n` +
    `❓ <i>${esc(item.q)}</i>\n` +
    `✅ <b>Javob:</b> <code>${esc(item.a)}</code>`
  );
}

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
    `Endi <b>${esc(n)}</b>${grp(g)} ning kunlik dars natijalari, telefon nazorati va rasmiy to‘lov cheklari shu yerga kelib turadi.\n\n` +
    `👇 Pastdagi qulay <b>Bosh Panel</b> tugmalaridan istalgan vaqt foydalanishingiz mumkin!`,
  unlinked: "🔌 Ulanish uzildi. Qayta ulash uchun /start ni bosing.",
  done: (n, g, streak = 0, dateStr = '', focus = null) =>
    `🌟 <b>Kunlik hisobot${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `✅ <b>Holat:</b> Bugungi darsni bajardi!` +
    `${streak >= 2 ? `\n🔥 <b>Ketma-ketlik:</b> ${streak} kun uzluksiz` : ''}` +
    formatFocusBlock(focus) +
    formatDinnerQuizBlock(`${n}:${dateStr}`),
  missed: (n, g, steps, row, dateStr = '', focus = null) =>
    `📌 <b>Kunlik hisobot${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `❗️ <b>Holat:</b> Bugun dars qilmadi` +
    `${steps ? `\n📊 Darsdan ${steps} bosqich bajarilgan.` : ''}` +
    `${row > 1 ? `\n⚠️ Ketma-ket <b>${row} kun</b> dars o‘tkazildi.` : ''}` +
    formatFocusBlock(focus) +
    `\n\nQuyidagi tugmalardan birini tanlashingiz mumkin:`,
  praiseSent: "👏 Rahmat! Maqtovingiz farzandingiz telefoniga (+10 Bonus XP) yuboriladi ❤️",
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
  distractAlert: (n, g, focus, dateStr = '') => {
    const games = focus?.games_minutes || 0;
    const other = focus?.other_apps_minutes || 0;
    const total = Math.max(focus?.total_distract_minutes || 0, games + other);
    const gList = (focus?.top_games || []).slice(0, 3).map((x) => `${esc(x.name)} (${x.minutes} daq)`).join(', ');
    const aList = (focus?.top_apps || []).slice(0, 3).map((x) => `${esc(x.name)} (${x.minutes} daq)`).join(', ');
    const lines = [
      `⚠️ <b>Diqqat ogohlantirishi (15+ daqiqa)</b>${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}`,
      '',
      `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}`,
      `📚 <b>Dars holati:</b> Bugungi dars hali bajarilmagan!`,
      `⏱ <b>O‘yin va boshqa platformalar:</b> <b>${total} daqiqa</b>`,
    ];
    if (games > 0) lines.push(`• 🎮 O‘yinlar: <b>${games} daqiqa</b>${gList ? ` (${gList})` : ''}`);
    if (other > 0) lines.push(`• 📱 Boshqa platformalar: <b>${other} daqiqa</b>${aList ? ` (${aList})` : ''}`);
    if ((focus?.study_minutes || 0) > 0) lines.push(`• 📚 Enzo Academy: <b>${focus.study_minutes} daqiqa</b>`);
    lines.push('', '💡 Farzandingizga avval bugungi 15 daqiqalik darsini tugatib olishni eslatib qo‘ying.');
    return lines.join('\n');
  },
  paymentReceipt: ({ fullName, groupName, amount, paidDateStr, nextDueStr, receiptNo, note }) =>
    `🧾 <b>RASMIY TO‘LOV CHEKI — ENZO ACADEMY</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 <b>Chek raqami:</b> <code>${esc(receiptNo)}</code>\n` +
    `👤 <b>O‘quvchi:</b> ${esc(fullName)}${grp(groupName)}\n` +
    `${amount ? `💰 <b>To‘langan summa:</b> <b>${esc(amount)} so‘m</b>\n` : ''}` +
    `📅 <b>To‘lov sanasi:</b> ${esc(paidDateStr)}\n` +
    `${nextDueStr ? `📆 <b>Keyingi to‘lov sanasi:</b> ${esc(nextDueStr)}\n` : ''}` +
    `✅ <b>Holat:</b> TO‘LANDI (Obuna faol)\n` +
    `${note ? `📝 <b>Izoh:</b> ${esc(note)}\n` : ''}` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤝 Ishonchingiz uchun rahmat! Farzandingizga o‘qishda omad tilaymiz 🎓`,
  focusPanelCard: (n, g, focus, dateStr = '') =>
    `📱 <b>Telefon va o‘yin nazorati</b>${dateStr ? ` — ${esc(fmtDate(dateStr))}` : ''}\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}` +
    (focus ? formatFocusBlock(focus) : '\n\nℹ️ Bugun uchun hali telefon statistikasi kelmagan (farzandingiz ilovaga kirishi bilan yangilanadi).'),
  rankingCard: (n, g, rank, total, xp, streak, w) =>
    `🏆 <b>Guruh reytingi va o‘sish</b>\n\n` +
    `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
    `🥇 <b>Guruhdagi o‘rni:</b> <b>${rank}-o‘rin</b> (${total} nafar o‘quvchidan)\n` +
    `⭐ <b>Jami ball (XP):</b> <b>${xp}</b>\n` +
    `🔥 <b>Ketma-ketlik:</b> <b>${streak} kun</b>\n` +
    `📚 <b>Oxirgi 7 kun:</b> <b>${w.done}/${w.lesson}</b> dars bajarildi` +
    `${rank <= 3 ? '\n\n🌟 Ajoyib natija! Top-3 yetakchilar safida!' : '\n\n💪 Har kunlik 15 daqiqalik dars bilan Top-3 ga chiqish mumkin!'}`,
  paymentStatusCard: (n, g, info, dueStr, fee, payDay) => {
    const badge = info.state === 'blocked'
      ? '🔒 Bloklangan (to‘lov kutilmoqda)'
      : info.state === 'grace'
        ? `⏳ Muddat o‘tgan (${info.grace_days_left} kun imtiyozli vaqt)`
        : `✅ Faol (${info.days_left} kun qoldi)`;
    return (
      `💳 <b>To‘lov holati</b>\n\n` +
      `👤 <b>O‘quvchi:</b> ${esc(n)}${grp(g)}\n` +
      `📌 <b>Holat:</b> ${badge}\n` +
      `${dueStr ? `📅 <b>Keyingi to‘lov sanasi:</b> ${esc(dueStr)}\n` : ''}` +
      `${fee ? `💰 <b>Oylik to‘lov:</b> ${esc(fee)} so‘m\n` : ''}` +
      `🗓 <b>Oylik to‘lov kuni:</b> har oyning ${payDay || 1}-kuni`
    );
  },
  askReceipt: '📸 To‘lov cheki skrinshotini (rasm) yoki to‘lov haqida ma’lumotni shu yerga yuboring:',
  parentReceiptSent: '🧾 To‘lov chekingiz ustozga yuborildi! Tasdiqlanishi bilan sizga rasmiy to‘lov cheki keladi.',
  receiptRejected: (n) => `❌ <b>To‘lov cheki tasdiqlanmadi</b> — ${esc(n)}\nIltimos, ustoz bilan bog‘lanib aniqlashtiring.`,
  teacherReceipt: (kid, g, who, note = '') =>
    `🧾 <b>Ota-onadan to‘lov cheki keldi!</b>\n` +
    `🎓 <b>O‘quvchi:</b> ${esc(kid)}${grp(g)}\n` +
    `👨‍👩‍👧 <b>Kimdan:</b> ${esc(who)}` +
    `${note ? `\n💬 <b>Izoh:</b> «${esc(note)}»` : ''}\n\n` +
    `Tasdiqlasangiz obuna avtomatik +1 oyga uzayadi va ota-onaga rasmiy chek boradi:`,
  teacherAskPaidName: '💳 <b>To‘lov qilgan o‘quvchining ism-familiyasini yozing</b> (masalan: <i>Ali Valiyev</i>):',
  teacherAskBroadcast: '📢 <b>Barcha ulangan ota-onalarga yuboriladigan e’lon matnini yozing:</b>\n<i>(Bekor qilish uchun «bekor» deb yozing)</i>',
};
const STATUS_LABEL = {
  done: '✅ Bugungi darsni bajardi',
  pending: '⏳ Hali bajarmadi (vaqt bor)',
  missed: '❌ Bugun dars qilmadi',
  excused: '📝 Sababli',
  off: '📅 Bugun dam / dars yo‘q',
};

module.exports = { esc, normName, matchStudents, firstName, fmtDate, formatFocusBlock, pickDinnerQuiz, T, STATUS_LABEL };
