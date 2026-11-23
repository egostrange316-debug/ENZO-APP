/**
 * Enzo Academy Telegram boti: ota-ona ulanishi (ism bo'yicha), kunlik natija, ustozga xabar.
 * Tashqi paket yo'q: Node 20 fetch. Hamma bog'liqliklar `deps` orqali beriladi (testda soxta).
 *   deps = { token, teacherIds:[], fetchFn, User, Group, CourseState, NotifyLog, BotState }
 * Qoida: kim ogohlantirilishini QATIY QOIDA hal qiladi (lib/dayStatus). Bot faqat xabar yetkazadi.
 */
const crypto = require('crypto');
const D = require('../lib/dayStatus');
const X = require('../lib/botText');
const { weeklyStats } = require('../lib/weeklyStats');
const { subscriptionInfo, nextDueDate, newEndForPayment, clampPayDay } = require('../lib/subscription');
const { T, esc } = X;

const PARENT_KB = [
  ['📊 Bugungi holat', '📱 Telefon nazorati'],
  ['📈 Haftalik hisobot', '🏆 Guruh reytingi'],
  ['💳 To‘lov holati', '👏 Maqtash (+10 XP)'],
  ['💬 Ustozga xabar', '➕ Farzand qo‘shish'],
];

const TEACHER_KB = [
  ['📊 Bugungi guruhlar', '⚠️ 3 kun qoldirganlar'],
  ['💳 Qarzdorlar / To‘lovlar', '✅ To‘landi (Chek)'],
  ['📢 Ota-onalarga e’lon'],
];

const DISTRACT_ALERT_MINUTES = 15;

const money = (n) => (n ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '');
const uzDate = (d) =>
  `${d.getUTCDate()}-${['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'][d.getUTCMonth()]}`;
const makeReceiptNo = (studentId, now = new Date()) => {
  const ymd = D.tashkentNow(now).date.replace(/-/g, '');
  const tail = String(studentId || '').slice(-4).toUpperCase() || crypto.randomBytes(2).toString('hex').toUpperCase();
  return `#ENZO-${ymd}-${tail}`;
};

function createBot(deps) {
  const { token, fetchFn = globalThis.fetch, User, Group, CourseState, NotifyLog, BotState, FocusLog = null } = deps;
  const teacherIds = (deps.teacherIds || []).map(String).filter(Boolean);
  const isTeacher = (id) => teacherIds.includes(String(id));

  async function api(method, payload) {
    if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN yo'q" };
    const r = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.json().catch(() => ({ ok: false }));
  }
  const send = (chat_id, text, buttons, replyKeyboard) => {
    const markup = buttons
      ? { reply_markup: { inline_keyboard: buttons } }
      : replyKeyboard
        ? { reply_markup: { keyboard: replyKeyboard, resize_keyboard: true } }
        : {};
    return api('sendMessage', {
      chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...markup,
    });
  };
  const sendPhoto = (chat_id, photo, caption, buttons) =>
    api('sendPhoto', {
      chat_id,
      photo,
      caption,
      parse_mode: 'HTML',
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  const toTeachers = (text, buttons) => Promise.all(teacherIds.map((id) => send(id, text, buttons)));
  const toTeachersPhoto = (photo, caption, buttons) => Promise.all(teacherIds.map((id) => sendPhoto(id, photo, caption, buttons)));
  const kb = (rows) => rows.map((r) => r.map(([text, data]) => ({ text, callback_data: data })));
  const panelFor = (chat) => (isTeacher(chat) ? TEACHER_KB : PARENT_KB);

  async function stateOf(student, today, hour) {
    const group = student.group_name ? await Group.findOne({ name: student.group_name }).lean() : null;
    const cs = await CourseState.findOne({ user: student._id }).select('state.pts state.d').lean();
    const joined = student.createdAt ? D.tashkentNow(new Date(student.createdAt)).date : null;
    return D.studentStatus({ group, state: cs && cs.state, excused_dates: student.excused_dates, today, hour, joined });
  }

  async function linkedKids(chat) {
    return User.find({ role: 'student', parent_chats: chat })
      .select('full_name group_name excused_dates createdAt subscription_end_date monthly_fee pay_day status streak')
      .lean();
  }

  async function notifyPaymentReceipt(student, paymentObj = null, nowDate = new Date()) {
    const parents = (student && student.parent_chats) || [];
    if (!parents.length) return 0;
    const paidAt = paymentObj && paymentObj.paid_at ? new Date(paymentObj.paid_at) : nowDate;
    const paidDateStr = X.fmtDate(D.tashkentNow(paidAt).date);
    const endDate = (paymentObj && paymentObj.paid_through) || student.subscription_end_date;
    const due = endDate ? nextDueDate(endDate) : null;
    const nextDueStr = due ? uzDate(new Date(due.getTime() + 5 * 3600000)) : '';
    const amountVal = (paymentObj && paymentObj.amount) || student.monthly_fee || 0;
    const receiptNo = makeReceiptNo(student._id, paidAt);
    const text = T.paymentReceipt({
      fullName: student.full_name,
      groupName: student.group_name,
      amount: money(amountVal),
      paidDateStr,
      nextDueStr,
      receiptNo,
      note: paymentObj && paymentObj.note ? paymentObj.note : '',
    });
    let sentCount = 0;
    for (const p of parents) {
      const res = await send(p, text);
      if (res && res.ok) sentCount++;
    }
    return sentCount;
  }

  async function recordTelegramPayment(student, note = 'Telegram bot orqali tasdiqlandi', nowDate = new Date()) {
    const current = student.subscription_end_date || null;
    const target = newEndForPayment(current, clampPayDay(student.pay_day), nowDate, nowDate);
    const entry = {
      paid_at: nowDate,
      recorded_at: nowDate,
      paid_through: target,
      kind: 'cycle',
      amount: student.monthly_fee || undefined,
      note,
      pid: crypto.randomBytes(6).toString('hex'),
      prev_end: current,
      prev_status: student.status,
    };
    if (!Array.isArray(student.payments)) student.payments = [];
    student.payments.push(entry);
    if (student.payments.length > 60) student.payments = student.payments.slice(-60);
    student.status = 'active';
    student.subscription_end_date = target;
    await student.save();
    const sentCount = await notifyPaymentReceipt(student, entry, nowDate);
    return { target, entry, sentCount };
  }

  async function sendPaidLookup(chat, query) {
    const students = await User.find({ role: 'student' }).select('full_name group_name monthly_fee pay_day').lean();
    const found = X.matchStudents(query, students);
    if (!found.length) return void (await send(chat, T.notFound, null, TEACHER_KB));
    const rows = found.map((s) => [
      [`✅ To‘landi (+1 oy): ${s.full_name} (${s.group_name || 'Guruhsiz'})`, `payok:${s._id}`],
    ]);
    await send(chat, '💳 <b>To‘lovni tasdiqlash va rasmiy chek yuborish</b> — o‘quvchini tanlang:', kb(rows));
  }

  // ---------- kiruvchi xabarlar ----------
  async function onMessage(msg) {
    const chat = String(msg.chat.id);
    const text = String(msg.text || msg.caption || '').trim();
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    if (msg.chat.type !== 'private') return; // faqat shaxsiy suhbat: boshqa bolalar ma'lumoti ochiq guruhda chiqmasin
    if (text === '/start' || text === '/start@') {
      if (isTeacher(chat)) {
        await BotState.deleteOne({ chat_id: chat });
        await send(
          chat,
          "👨‍🏫 <b>Ustoz Bosh Paneli</b>\nQuyidagi tugmalar orqali guruhlar, to‘lovlar va ota-onalarga rasmiy chek yuborishni boshqaring:",
          null,
          TEACHER_KB
        );
        return;
      }
      const existingKids = await linkedKids(chat);
      if (existingKids.length) {
        await BotState.deleteOne({ chat_id: chat });
        await send(
          chat,
          `👋 <b>Xush kelibsiz!</b> Sizga ulangan o‘quvchilar: ${existingKids.map((k) => `<b>${esc(k.full_name)}</b>`).join(', ')}.\n\n👇 Pastdagi Bosh Panel tugmalaridan foydalaning:`,
          null,
          PARENT_KB
        );
        return;
      }
      await BotState.findOneAndUpdate({ chat_id: chat }, { step: 'await_name', tries: 0, meta: {}, at: new Date() }, { upsert: true });
      await send(chat, T.welcome);
      if (!teacherIds.length) await send(chat, T.teacherId(chat));
      return;
    }
    if (text === '/id') return void (await send(chat, T.teacherId(chat)));
    if (text === '/uzish') {
      await User.updateMany({ parent_chats: chat }, { $pull: { parent_chats: chat } });
      await BotState.deleteOne({ chat_id: chat });
      return void (await send(chat, T.unlinked));
    }

    // ---------- Ota-ona Bosh Panel tugmalari ----------
    if (text === '/bolalarim' || text === '/holat' || text === '📊 Bugungi holat') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const now = D.tashkentNow();
      const lines = [];
      for (const k of kids) {
        if (text === '/bolalarim') lines.push(`👤 <b>${esc(k.full_name)}</b> (${esc(k.group_name || 'Guruhsiz')})`);
        else {
          const stInfo = await stateOf(k, now.date, now.hour);
          const fl = FocusLog && typeof FocusLog.findOne === 'function'
            ? await FocusLog.findOne({ user: k._id, date: now.date }).lean()
            : null;
          lines.push(T.status(k.full_name, X.STATUS_LABEL[stInfo.status], k.group_name) + (fl ? X.formatFocusBlock(fl) : ''));
        }
      }
      return void (await send(chat, lines.join('\n\n'), null, panelFor(chat)));
    }

    if (text === '📱 Telefon nazorati') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const now = D.tashkentNow();
      const cards = [];
      for (const k of kids) {
        const fl = FocusLog && typeof FocusLog.findOne === 'function'
          ? await FocusLog.findOne({ user: k._id, date: now.date }).lean()
          : null;
        cards.push(T.focusPanelCard(k.full_name, k.group_name, fl, now.date));
      }
      return void (await send(chat, cards.join('\n\n'), null, PARENT_KB));
    }

    if (text === '📈 Haftalik hisobot') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const now = D.tashkentNow();
      const cards = [];
      for (const k of kids) {
        const g = k.group_name ? await Group.findOne({ name: k.group_name }).lean() : null;
        const cs = await CourseState.findOne({ user: k._id }).select('state.pts state.d').lean();
        const joined = k.createdAt ? D.tashkentNow(new Date(k.createdAt)).date : null;
        const w = weeklyStats({ group: g, state: cs && cs.state, excused_dates: k.excused_dates, today: now.date, joined });
        cards.push(T.weekly(k.full_name, w, k.group_name));
      }
      return void (await send(chat, cards.join('\n\n'), null, PARENT_KB));
    }

    if (text === '🏆 Guruh reytingi') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const now = D.tashkentNow();
      const cards = [];
      for (const k of kids) {
        const peers = await User.find({ role: 'student', group_name: k.group_name, status: { $ne: 'blocked' } }).select('_id').lean();
        const peerIds = peers.length ? peers.map((p) => p._id) : [k._id];
        const states = await CourseState.find({ user: { $in: peerIds } }).select('user state.pts state.d').lean();
        const ptsMap = new Map(states.map((s) => [String(s.user), Number(s.state && s.state.pts) || 0]));
        const myPts = ptsMap.get(String(k._id)) || 0;
        const sorted = peerIds.map((pid) => ({ id: String(pid), pts: ptsMap.get(String(pid)) || 0 })).sort((a, b) => b.pts - a.pts);
        const rank = Math.max(1, sorted.findIndex((x) => x.id === String(k._id)) + 1);
        const myCs = states.find((s) => String(s.user) === String(k._id));
        const g = k.group_name ? await Group.findOne({ name: k.group_name }).lean() : null;
        const joined = k.createdAt ? D.tashkentNow(new Date(k.createdAt)).date : null;
        const w = weeklyStats({ group: g, state: myCs && myCs.state, excused_dates: k.excused_dates, today: now.date, joined });
        const streakVal = Math.max(k.streak || 0, w.streak || 0);
        cards.push(T.rankingCard(k.full_name, k.group_name, rank, sorted.length, myPts, streakVal, w));
      }
      return void (await send(chat, cards.join('\n\n'), null, PARENT_KB));
    }

    if (text === '💳 To‘lov holati') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const nowDate = new Date();
      for (const k of kids) {
        const info = subscriptionInfo(k, nowDate);
        const due = info.end_date ? nextDueDate(info.end_date) : null;
        const dueStr = due ? uzDate(new Date(due.getTime() + 5 * 3600000)) : '';
        await send(
          chat,
          T.paymentStatusCard(k.full_name, k.group_name, info, dueStr, money(k.monthly_fee), k.pay_day),
          kb([[['🧾 To‘lov chekini yuborish', `receipt:${k._id}`]]])
        );
      }
      return;
    }

    if (text === '👏 Maqtash (+10 XP)') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const today = D.tashkentNow().date;
      if (FocusLog && typeof FocusLog.findOneAndUpdate === 'function') {
        for (const k of kids) {
          await FocusLog.findOneAndUpdate({ user: k._id, date: today }, { $inc: { pending_praise: 1 } }, { upsert: true }).catch(() => {});
        }
      }
      return void (await send(chat, T.praiseSent, null, PARENT_KB));
    }

    if (text === '💬 Ustozga xabar') {
      const kids = await linkedKids(chat);
      if (!kids.length) return void (await send(chat, T.noKids));
      const today = D.tashkentNow().date;
      if (kids.length === 1) {
        await BotState.findOneAndUpdate(
          { chat_id: chat },
          { step: 'await_excuse', tries: 0, meta: { studentId: String(kids[0]._id), date: today }, at: new Date() },
          { upsert: true }
        );
        return void (await send(chat, T.askExcuse));
      }
      const rows = kids.map((k) => [[`✍️ ${k.full_name} (${k.group_name || 'Guruhsiz'})`, `excuse:${k._id}:${today}`]]);
      return void (await send(chat, 'Qaysi farzandingiz bo‘yicha ustozga yozmoqchisiz?', kb(rows)));
    }

    if (text === '➕ Farzand qo‘shish') {
      await BotState.findOneAndUpdate({ chat_id: chat }, { step: 'await_name', tries: 0, meta: {}, at: new Date() }, { upsert: true });
      return void (await send(chat, '👇 Qo‘shmoqchi bo‘lgan farzandingizning <b>ism-familiyasini</b> yozing:'));
    }

    // ---------- Ustoz Bosh Panel tugmalari va tezkor buyruqlar ----------
    if ((text === '/bugun' || text === '📊 Bugungi guruhlar') && isTeacher(chat)) {
      return void (await send(chat, await teacherSummary(), null, TEACHER_KB));
    }

    if (text === '⚠️ 3 kun qoldirganlar' && isTeacher(chat)) {
      const now = D.tashkentNow();
      const all = (await collect(now)).filter((x) => x.s.status !== 'blocked' && x.r.missed_in_row >= 3);
      if (!all.length) return void (await send(chat, '✅ Ajoyib! Ketma-ket 3 kun dars qoldirgan o‘quvchi yo‘q.', null, TEACHER_KB));
      const lines = all.map((x) => `🚨 <b>${esc(x.s.full_name)}</b> (${esc(x.s.group_name || 'Guruhsiz')}) — <b>${x.r.missed_in_row} kun</b>`);
      return void (await send(chat, `⚠️ <b>3+ kun ketma-ket dars qoldirganlar (${all.length} nafar):</b>\n\n${lines.join('\n')}`, null, TEACHER_KB));
    }

    if (text === '💳 Qarzdorlar / To‘lovlar' && isTeacher(chat)) {
      const nowDate = new Date();
      const students = await User.find({ role: 'student' }).select('full_name group_name subscription_end_date monthly_fee status').lean();
      const list = [];
      for (const s of students) {
        if (!s.subscription_end_date) continue;
        const info = subscriptionInfo(s, nowDate);
        if (info.state === 'blocked' || info.state === 'grace' || (info.state === 'paid' && info.days_left <= 3)) {
          const tag = info.state === 'blocked' ? '🔒 Blok' : info.state === 'grace' ? `⏳ Muddat o‘tgan (${info.grace_days_left}k)` : `🔔 ${info.days_left} kun qoldi`;
          list.push(`• <b>${esc(s.full_name)}</b> (${esc(s.group_name || 'Guruhsiz')}) — ${tag}`);
        }
      }
      const msgOut = list.length
        ? `💳 <b>To‘lovi yaqin va muddati o‘tganlar (${list.length} nafar):</b>\n\n${list.join('\n')}\n\n💡 To‘lov qilganni belgilash uchun <b>«✅ To‘landi (Chek)»</b> tugmasini bosing.`
        : '✅ Hozircha qarzdor yoki to‘lovi yaqin o‘quvchi yo‘q.';
      return void (await send(chat, msgOut, null, TEACHER_KB));
    }

    if (text === '✅ To‘landi (Chek)' && isTeacher(chat)) {
      await BotState.findOneAndUpdate({ chat_id: chat }, { step: 'await_paid_name', tries: 0, meta: {}, at: new Date() }, { upsert: true });
      return void (await send(chat, T.teacherAskPaidName));
    }

    if (isTeacher(chat) && /^(\/?to['‘’]?landi)\s+(.+)/i.test(text)) {
      const query = text.replace(/^(\/?to['‘’]?landi)\s+/i, '').trim();
      return void (await sendPaidLookup(chat, query));
    }

    if (text === '📢 Ota-onalarga e’lon' && isTeacher(chat)) {
      await BotState.findOneAndUpdate({ chat_id: chat }, { step: 'await_broadcast', tries: 0, meta: {}, at: new Date() }, { upsert: true });
      return void (await send(chat, T.teacherAskBroadcast));
    }

    const st = await BotState.findOne({ chat_id: chat }).lean();
    if (st && st.step === 'await_paid_name' && isTeacher(chat)) {
      await BotState.deleteOne({ chat_id: chat });
      return void (await sendPaidLookup(chat, text));
    }

    if (st && st.step === 'await_broadcast' && isTeacher(chat)) {
      await BotState.deleteOne({ chat_id: chat });
      if (!text || /^bekor$/i.test(text)) return void (await send(chat, '❎ E’lon bekor qilindi.', null, TEACHER_KB));
      const allStudents = await User.find({ role: 'student' }).select('parent_chats').lean();
      const uniqueParents = [...new Set(allStudents.flatMap((s) => s.parent_chats || []))];
      let okCount = 0;
      const body = `📢 <b>Enzo Academy e’loni:</b>\n\n${esc(text)}`;
      for (const p of uniqueParents) {
        const res = await send(p, body);
        if (res && res.ok) okCount++;
      }
      return void (await send(chat, `✅ E’lon <b>${okCount}/${uniqueParents.length}</b> nafar ota-onaga yuborildi.`, null, TEACHER_KB));
    }

    if (st && st.step === 'await_receipt' && st.meta && st.meta.studentId) {
      const student = await User.findOne({ _id: st.meta.studentId, role: 'student' });
      await BotState.deleteOne({ chat_id: chat });
      if (!student || !(student.parent_chats || []).includes(chat)) return;
      const who = [msg.from && msg.from.first_name, msg.from && msg.from.username ? '@' + msg.from.username : ''].filter(Boolean).join(' ') || chat;
      const caption = T.teacherReceipt(student.full_name, student.group_name, who, text);
      const btns = kb([[['✅ Tasdiqlash (+1 oy)', `payok:${student._id}`], ['❌ Rad etish', `payno:${student._id}`]]]);
      await send(chat, T.parentReceiptSent, null, PARENT_KB);
      if (hasPhoto) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await toTeachersPhoto(fileId, caption, btns);
      } else {
        await toTeachers(caption, btns);
      }
      return;
    }

    if (st && st.step === 'await_excuse' && st.meta && st.meta.studentId) {
      const student = await User.findOne({ _id: st.meta.studentId, role: 'student' });
      await BotState.deleteOne({ chat_id: chat });
      if (!student || !(student.parent_chats || []).includes(chat)) return;
      const targetDate = st.meta.date || D.tashkentNow().date;
      await send(chat, T.parentExcuseSent, null, PARENT_KB);
      await toTeachers(
        T.teacherExcuse(student.full_name, text, student.group_name),
        kb([[['✅ Tasdiqlash', `confirm:${student._id}:${targetDate}`], ['❌ Rad etish', `reject:${student._id}:${targetDate}`]]])
      );
      return;
    }

    if (!st || st.step !== 'await_name') return void (await send(chat, 'Boshlash uchun /start ni bosing.'));
    const students = await User.find({ role: 'student' }).select('full_name group_name pay_day').lean();
    const found = X.matchStudents(text, students);
    if (!found.length) {
      const tries = (st.tries || 0) + 1;
      await BotState.updateOne({ chat_id: chat }, { tries });
      if (tries >= 3) {
        await toTeachers(`❓ Botda ism topilmadi (3 urinish): «${esc(text)}» — chat <code>${esc(chat)}</code>`);
        return void (await send(chat, T.tooMany));
      }
      return void (await send(chat, T.notFound));
    }
    const rows = found.map((s) => [
      [`👤 ${s.full_name} • ${s.group_name || 'Guruhsiz'} • 🗓 To'lov: ${s.pay_day || 1}-kun`, `link:${s._id}`],
    ]);
    await send(chat, T.pick, kb(rows));
  }

  // ---------- tugmalar ----------
  async function onCallback(cb) {
    const chat = String(cb.message && cb.message.chat ? cb.message.chat.id : cb.from.id);
    const [kind, id, date] = String(cb.data || '').split(':');
    await api('answerCallbackQuery', { callback_query_id: cb.id });
    const student = /^[a-f0-9]{24}$/.test(id || '') ? await User.findOne({ _id: id, role: 'student' }) : null;
    if (!student) return;
    const today = D.tashkentNow().date;
    const parentOf = () => (student.parent_chats || []).includes(chat);
    const who = [cb.from.first_name, cb.from.username ? '@' + cb.from.username : ''].filter(Boolean).join(' ') || chat;

    if (kind === 'link') {
      const cur = student.parent_chats || [];
      if (cur.includes(chat)) return void (await send(chat, T.linked(student.full_name, student.group_name), null, PARENT_KB));
      if (cur.length >= 3) return void (await send(chat, T.limit));
      student.parent_chats = [...cur, chat];
      await student.save();
      await BotState.deleteOne({ chat_id: chat });
      await send(chat, T.linked(student.full_name, student.group_name), null, PARENT_KB);
      await toTeachers(
        T.teacherNewLink(student.full_name, who, student.group_name),
        kb([[['❌ Rad etish', `unlink:${student._id}:${chat}`]]])
      );
    } else if (kind === 'unlink' && isTeacher(chat)) {
      student.parent_chats = (student.parent_chats || []).filter((c) => c !== date);
      await student.save();
      await send(chat, `🔌 Ajratildi: <b>${esc(student.full_name)}</b>`);
      await send(date, T.unlinked);
    } else if (kind === 'excuse' && parentOf()) {
      await BotState.findOneAndUpdate(
        { chat_id: chat },
        { step: 'await_excuse', tries: 0, meta: { studentId: String(student._id), date: date || today }, at: new Date() },
        { upsert: true }
      );
      await send(chat, T.askExcuse);
    } else if (kind === 'receipt' && parentOf()) {
      await BotState.findOneAndUpdate(
        { chat_id: chat },
        { step: 'await_receipt', tries: 0, meta: { studentId: String(student._id) }, at: new Date() },
        { upsert: true }
      );
      await send(chat, T.askReceipt);
    } else if (kind === 'payok' && isTeacher(chat)) {
      const { target, sentCount } = await recordTelegramPayment(student);
      const due = nextDueDate(target);
      const dueStr = due ? uzDate(new Date(due.getTime() + 5 * 3600000)) : '';
      await send(
        chat,
        `✅ <b>To‘lov tasdiqlandi!</b>\n👤 ${esc(student.full_name)} — obuna <b>${esc(dueStr)}</b> gacha uzaytirildi.\n🧾 Rasmiy to‘lov cheki <b>${sentCount}</b> nafar ota-onaga yuborildi.`,
        null,
        TEACHER_KB
      );
    } else if (kind === 'payno' && isTeacher(chat)) {
      await send(chat, `❌ To‘lov cheki rad etildi: <b>${esc(student.full_name)}</b>`, null, TEACHER_KB);
      for (const p of student.parent_chats || []) await send(p, T.receiptRejected(student.full_name));
    } else if (kind === 'call' && parentOf()) {
      await send(chat, T.parentCallSent);
      await toTeachers(T.teacherCall(student.full_name, student.group_name, who));
    } else if (kind === 'praise' && parentOf()) {
      if (FocusLog && typeof FocusLog.findOneAndUpdate === 'function') {
        await FocusLog.findOneAndUpdate(
          { user: student._id, date: date || today },
          { $inc: { pending_praise: 1 } },
          { upsert: true }
        ).catch(() => {});
      }
      await send(chat, T.praiseSent);
    } else if (kind === 'confirm' && isTeacher(chat) && D.validDate(date)) {
      student.excused_dates = [...new Set([...(student.excused_dates || []), date])].sort();
      await student.save();
      await send(chat, T.excuseConfirmed(student.full_name, date));
      for (const p of student.parent_chats || []) await send(p, T.excuseConfirmed(student.full_name, date));
    } else if (kind === 'reject' && isTeacher(chat)) {
      await send(chat, T.excuseRejected(student.full_name, date || today));
      for (const p of student.parent_chats || []) await send(p, T.excuseRejected(student.full_name, date || today));
    }
  }

  async function handleUpdate(update) {
    try {
      if (update && update.message) await onMessage(update.message);
      else if (update && update.callback_query) await onCallback(update.callback_query);
    } catch (e) {
      console.error('telegramBot xatosi:', e.message);
    }
  }

  async function notifyAccountStatus(student, blocked) {
    const parents = (student && student.parent_chats) || [];
    if (!parents.length) return 0;
    const text = blocked
      ? T.accountBlocked(student.full_name, student.group_name)
      : T.accountUnblocked(student.full_name, student.group_name);
    let sentCount = 0;
    for (const p of parents) {
      const res = await send(p, text);
      if (res && res.ok) sentCount++;
    }
    return sentCount;
  }

  // ---------- ustoz hisoboti ----------
  async function collect(now) {
    const groups = await Group.find().lean();
    const gBy = new Map(groups.map((g) => [g.name, g]));
    const students = await User.find({ role: 'student' })
      .select('full_name group_name excused_dates createdAt parent_chats subscription_end_date monthly_fee pay_day status streak')
      .lean();
    const cs = await CourseState.find({ user: { $in: students.map((s) => s._id) } }).select('user state.pts state.d').lean();
    const by = new Map(cs.map((c) => [String(c.user), c.state]));
    const fl = FocusLog && typeof FocusLog.find === 'function'
      ? await FocusLog.find({ date: now.date, user: { $in: students.map((s) => s._id) } }).lean()
      : [];
    const focusBy = new Map(fl.map((f) => [String(f.user), f]));
    return students.map((s) => {
      const g = gBy.get(s.group_name) || null;
      const joined = s.createdAt ? D.tashkentNow(new Date(s.createdAt)).date : null;
      return {
        s,
        g,
        state: by.get(String(s._id)),
        focus: focusBy.get(String(s._id)) || null,
        joined,
        r: D.studentStatus({ group: g, state: by.get(String(s._id)), excused_dates: s.excused_dates, today: now.date, hour: now.hour, joined }),
      };
    });
  }

  async function teacherSummary() {
    const now = D.tashkentNow();
    const all = (await collect(now)).filter((x) => x.s.status !== 'blocked');
    const names = [...new Set(all.map((x) => x.s.group_name || 'Guruhsiz'))];
    const out = [];
    for (const n of names) {
      const part = all.filter((x) => (x.s.group_name || 'Guruhsiz') === n);
      const c = (k) => part.filter((x) => x.r.status === k).length;
      out.push(`🏷 <b>${esc(n)}</b> (${part.length} nafar)\n├ ✅ Bajardi: ${c('done')} | ⏳ Jarayonda: ${c('pending')}\n└ 📝 Sababli: ${c('excused')} | ❌ Bajarmadi: ${c('missed')}`);
    }
    return `📊 <b>Bugungi holat</b> — ${X.fmtDate(now.date)}\n\n` + (out.join('\n\n') || "O'quvchi yo'q");
  }

  /** Bir marta yuborish: avval kalitni yozamiz (ikki marta ketmasin), yuborilmasa kalitni o'chirib, keyingi safar qayta urinamiz */
  async function once(key, fn) {
    try {
      await NotifyLog.create({ key });
    } catch (e) {
      if (e && e.code === 11000) return false;
      throw e;
    }
    try {
      const ok = await fn();
      if (ok === false) {
        await NotifyLog.deleteOne({ key });
        return false;
      }
      return true;
    } catch (e) {
      await NotifyLog.deleteOne({ key });
      throw e;
    }
  }

  /** 15+ daqiqa o'yin yoki boshqa platformada o'tirgan va bugungi darsi bajarilmagan bo'lsa — darhol ota-onaga ogohlantirish */
  async function checkDistractionAlert(student, focus, nowDate = new Date()) {
    if (!token || !student || student.status === 'blocked' || !focus || !focus.usage_access) return false;
    const parents = student.parent_chats || [];
    if (!parents.length) return false;
    const now = D.tashkentNow(nowDate);
    if (now.hour < 8) return false;
    const totalDistract = Math.max(
      focus.total_distract_minutes || 0,
      (focus.games_minutes || 0) + (focus.other_apps_minutes || 0)
    );
    if (totalDistract < DISTRACT_ALERT_MINUTES) return false;
    const r = await stateOf(student, now.date, now.hour);
    if (!r.lesson_today || r.status === 'done' || r.status === 'excused') return false;
    return once(`distract15:${student._id}:${now.date}`, async () => {
      let any = false;
      for (const p of parents) {
        const res = await send(p, T.distractAlert(student.full_name, student.group_name, focus, now.date));
        if (res && res.ok) any = true;
      }
      return any;
    });
  }

  /** Har 5–10 daqiqada chaqiriladi. Soat 8:00–23:59 (Toshkent) oralig'ida ishlaydi. */
  async function runCheck(nowDate = new Date()) {
    const now = D.tashkentNow(nowDate);
    const sent = { done: 0, missed: 0, digest: 0, risk: 0, pay: 0, weekly: 0, distract: 0 };
    if (!token || now.hour < 8) return sent;
    const allAll = await collect(now);
    const all = allAll.filter((x) => x.s.status !== 'blocked');
    const okSend = (r) => !!(r && r.ok);

    for (const { s, g, state, focus, joined, r } of all) {
      const parents = s.parent_chats || [];
      if (focus && focus.usage_access && parents.length && r.lesson_today && r.status !== 'done' && r.status !== 'excused') {
        const totalDistract = Math.max(
          focus.total_distract_minutes || 0,
          (focus.games_minutes || 0) + (focus.other_apps_minutes || 0)
        );
        if (totalDistract >= DISTRACT_ALERT_MINUTES) {
          if (
            await once(`distract15:${s._id}:${now.date}`, async () => {
              let any = false;
              for (const p of parents) any = okSend(await send(p, T.distractAlert(s.full_name, s.group_name, focus, now.date))) || any;
              return any;
            })
          ) {
            sent.distract++;
          }
        }
      }
      if (r.status === 'done' && parents.length) {
        const w = weeklyStats({ group: g, state, excused_dates: s.excused_dates, today: now.date, joined });
        const streakVal = Math.max(s.streak || 0, w.streak || 0);
        if (
          await once(`done:${s._id}:${now.date}`, async () => {
            let any = false;
            for (const p of parents) {
              any =
                okSend(
                  await send(
                    p,
                    T.done(s.full_name, s.group_name, streakVal, now.date, focus),
                    kb([[['👏 Farzandimni maqtash', `praise:${s._id}:${now.date}`]]])
                  )
                ) || any;
            }
            return any;
          })
        ) {
          sent.done++;
        }
      }
      if (r.status === 'missed' && parents.length) {
        if (
          await once(`missed:${s._id}:${now.date}`, async () => {
            let any = false;
            for (const p of parents) {
              any =
                okSend(
                  await send(
                    p,
                    T.missed(s.full_name, s.group_name, r.steps_done, r.missed_in_row, now.date, focus),
                    kb([[['📝 Sabab kiritish', `excuse:${s._id}:${now.date}`], ["📞 Ustoz bog'lansin", `call:${s._id}`]]])
                  )
                ) || any;
            }
            return any;
          })
        ) {
          sent.missed++;
        }
      }
      if (r.status === 'missed' && r.missed_in_row >= 3) {
        if (
          await once(`risk:${s._id}:${now.date}`, async () => {
            await toTeachers(T.teacherRisk(s.full_name, r.missed_in_row, parents.length > 0, s.group_name));
            return true;
          })
        ) {
          sent.risk++;
        }
      }
    }

    // Ota-onaga to'lov eslatmasi (10:00 dan keyin), blok xabari va yakshanba kechqurun haftalik hisobot
    for (const { s, g, state, joined } of allAll) {
      const parents = s.parent_chats || [];
      if (!parents.length) continue;
      const fanout = async (text, buttons) => {
        let any = false;
        for (const p of parents) any = okSend(await send(p, text, buttons)) || any;
        return any;
      };
      if (now.hour >= 10 && s.subscription_end_date) {
        const info = subscriptionInfo(s, nowDate);
        const due = nextDueDate(info.end_date);
        const dueStr = uzDate(new Date(due.getTime() + 5 * 3600000));
        const endKey = new Date(info.end_date).toISOString().slice(0, 10);
        const receiptBtn = kb([[['🧾 To‘lov chekini yuborish', `receipt:${s._id}`]]]);
        if (info.state === 'paid' && (info.days_left === 3 || info.days_left === 1)) {
          if (await once(`pay:${s._id}:${endKey}:${info.days_left}`, () => fanout(T.payDue(s.full_name, info.days_left, dueStr, money(s.monthly_fee), s.group_name), receiptBtn))) sent.pay++;
        } else if (info.state === 'grace' && (info.grace_days_left === 5 || info.grace_days_left === 2 || info.grace_days_left === 1)) {
          if (await once(`payg:${s._id}:${endKey}:${info.grace_days_left}`, () => fanout(T.payGrace(s.full_name, info.grace_days_left, dueStr, money(s.monthly_fee), s.group_name), receiptBtn))) sent.pay++;
        } else if (s.status === 'blocked' || info.state === 'blocked') {
          if (await once(`blk:${s._id}:${endKey}`, () => fanout(T.accountBlocked(s.full_name, s.group_name), receiptBtn))) sent.pay++;
        }
      }
      if (s.status !== 'blocked' && D.weekdayOf(now.date) === 7 && now.hour >= 19) {
        const w = weeklyStats({ group: g, state, excused_dates: s.excused_dates, today: now.date, joined });
        if (w.lesson > 0 && (await once(`weekly:${s._id}:${now.date}`, () => fanout(T.weekly(s.full_name, w, s.group_name))))) sent.weekly++;
      }
    }

    // Ustozga guruh hisoboti: guruh muddati o'tgach, bir marta
    const groups = [...new Set(all.map((x) => x.s.group_name || ''))];
    for (const gname of groups) {
      const part = all.filter((x) => (x.s.group_name || '') === gname);
      if (!part.length || !part[0].r.lesson_today || now.hour < part[0].r.deadline_hour) continue;
      const missed = part
        .filter((x) => x.r.status === 'missed')
        .map((x) => ({ full_name: x.s.full_name, steps_done: x.r.steps_done, missed_in_row: x.r.missed_in_row }));
      const excusedNames = part.filter((x) => x.r.status === 'excused').map((x) => x.s.full_name);
      const doneCount = part.filter((x) => x.r.status === 'done').length;
      if (!missed.length) continue;
      if (
        await once(`digest:${gname}:${now.date}`, async () => {
          await toTeachers(T.teacherMissed(gname || 'Guruhsiz', missed, doneCount, excusedNames, now.date, part.length));
          return true;
        })
      ) {
        sent.digest++;
      }
    }
    return sent;
  }

  return {
    api,
    send,
    sendPhoto,
    handleUpdate,
    runCheck,
    teacherSummary,
    isTeacher,
    notifyAccountStatus,
    notifyPaymentReceipt,
    recordTelegramPayment,
    checkDistractionAlert,
  };
}

module.exports = { createBot };
