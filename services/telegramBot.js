/**
 * Enzo Academy Telegram boti: ota-ona ulanishi (ism bo'yicha), kunlik natija, ustozga xabar.
 * Tashqi paket yo'q: Node 20 fetch. Hamma bog'liqliklar `deps` orqali beriladi (testda soxta).
 *   deps = { token, teacherIds:[], fetchFn, User, Group, CourseState, NotifyLog, BotState }
 * Qoida: kim ogohlantirilishini QATIY QOIDA hal qiladi (lib/dayStatus). Bot faqat xabar yetkazadi.
 */
const D = require('../lib/dayStatus');
const X = require('../lib/botText');
const { weeklyStats } = require('../lib/weeklyStats');
const { subscriptionInfo, nextDueDate } = require('../lib/subscription');
const { T, esc } = X;

function createBot(deps) {
  const { token, fetchFn = globalThis.fetch, User, Group, CourseState, NotifyLog, BotState } = deps;
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
  const send = (chat_id, text, buttons) =>
    api('sendMessage', {
      chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  const toTeachers = (text, buttons) => Promise.all(teacherIds.map((id) => send(id, text, buttons)));
  const kb = (rows) => rows.map((r) => r.map(([text, data]) => ({ text, callback_data: data })));

  async function stateOf(student, today, hour) {
    const group = student.group_name ? await Group.findOne({ name: student.group_name }).lean() : null;
    const cs = await CourseState.findOne({ user: student._id }).select('state.pts state.d').lean();
    const joined = student.createdAt ? D.tashkentNow(new Date(student.createdAt)).date : null;
    return D.studentStatus({ group, state: cs && cs.state, excused_dates: student.excused_dates, today, hour, joined });
  }

  // ---------- kiruvchi xabarlar ----------
  async function onMessage(msg) {
    const chat = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    if (msg.chat.type !== 'private') return; // faqat shaxsiy suhbat: boshqa bolalar ma'lumoti ochiq guruhda chiqmasin
    if (text === '/start' || text === '/start@') {
      await BotState.findOneAndUpdate({ chat_id: chat }, { step: 'await_name', tries: 0, meta: {}, at: new Date() }, { upsert: true });
      await send(chat, T.welcome);
      if (isTeacher(chat)) await send(chat, "👨‍🏫 Siz ustoz sifatida ulangansiz. /bugun — bugungi holat.");
      else if (!teacherIds.length) await send(chat, T.teacherId(chat));
      return;
    }
    if (text === '/id') return void (await send(chat, T.teacherId(chat)));
    if (text === '/uzish') {
      await User.updateMany({ parent_chats: chat }, { $pull: { parent_chats: chat } });
      await BotState.deleteOne({ chat_id: chat });
      return void (await send(chat, T.unlinked));
    }
    if (text === '/bolalarim' || text === '/holat') {
      const kids = await User.find({ role: 'student', parent_chats: chat }).select('full_name group_name excused_dates createdAt').lean();
      if (!kids.length) return void (await send(chat, T.noKids));
      const now = D.tashkentNow();
      const lines = [];
      for (const k of kids) {
        if (text === '/bolalarim') lines.push(`👤 <b>${esc(k.full_name)}</b> (${esc(k.group_name || 'Guruhsiz')})`);
        else lines.push(T.status(k.full_name, X.STATUS_LABEL[(await stateOf(k, now.date, now.hour)).status], k.group_name));
      }
      return void (await send(chat, lines.join('\n\n')));
    }
    if (text === '/bugun' && isTeacher(chat)) return void (await send(chat, await teacherSummary()));

    const st = await BotState.findOne({ chat_id: chat }).lean();
    if (st && st.step === 'await_excuse' && st.meta && st.meta.studentId) {
      const student = await User.findOne({ _id: st.meta.studentId, role: 'student' });
      await BotState.deleteOne({ chat_id: chat });
      if (!student || !(student.parent_chats || []).includes(chat)) return;
      const targetDate = st.meta.date || D.tashkentNow().date;
      await send(chat, T.parentExcuseSent);
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
      if (cur.includes(chat)) return void (await send(chat, T.linked(student.full_name, student.group_name)));
      if (cur.length >= 3) return void (await send(chat, T.limit));
      student.parent_chats = [...cur, chat];
      await student.save();
      await BotState.deleteOne({ chat_id: chat });
      await send(chat, T.linked(student.full_name, student.group_name));
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
    } else if (kind === 'call' && parentOf()) {
      await send(chat, T.parentCallSent);
      await toTeachers(T.teacherCall(student.full_name, student.group_name, who));
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
    return students.map((s) => {
      const g = gBy.get(s.group_name) || null;
      const joined = s.createdAt ? D.tashkentNow(new Date(s.createdAt)).date : null;
      return {
        s,
        g,
        state: by.get(String(s._id)),
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

  /** Har 5–10 daqiqada chaqiriladi. Soat 8:00–23:59 (Toshkent) oralig'ida ishlaydi. */
  async function runCheck(nowDate = new Date()) {
    const now = D.tashkentNow(nowDate);
    const sent = { done: 0, missed: 0, digest: 0, risk: 0, pay: 0, weekly: 0 };
    if (!token || now.hour < 8) return sent;
    const allAll = await collect(now);
    const all = allAll.filter((x) => x.s.status !== 'blocked');
    const okSend = (r) => !!(r && r.ok);

    for (const { s, g, state, joined, r } of all) {
      const parents = s.parent_chats || [];
      if (r.status === 'done' && parents.length) {
        const w = weeklyStats({ group: g, state, excused_dates: s.excused_dates, today: now.date, joined });
        const streakVal = Math.max(s.streak || 0, w.streak || 0);
        if (
          await once(`done:${s._id}:${now.date}`, async () => {
            let any = false;
            for (const p of parents) any = okSend(await send(p, T.done(s.full_name, s.group_name, streakVal, now.date))) || any;
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
                    T.missed(s.full_name, s.group_name, r.steps_done, r.missed_in_row, now.date),
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
    const money = (n) => (n ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '');
    const uzDate = (d) =>
      `${d.getUTCDate()}-${['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'][d.getUTCMonth()]}`;
    for (const { s, g, state, joined } of allAll) {
      const parents = s.parent_chats || [];
      if (!parents.length) continue;
      const fanout = async (text) => {
        let any = false;
        for (const p of parents) any = okSend(await send(p, text)) || any;
        return any;
      };
      if (now.hour >= 10 && s.subscription_end_date) {
        const info = subscriptionInfo(s, nowDate);
        const due = nextDueDate(info.end_date);
        const dueStr = uzDate(new Date(due.getTime() + 5 * 3600000));
        const endKey = new Date(info.end_date).toISOString().slice(0, 10);
        if (info.state === 'paid' && (info.days_left === 3 || info.days_left === 1)) {
          if (await once(`pay:${s._id}:${endKey}:${info.days_left}`, () => fanout(T.payDue(s.full_name, info.days_left, dueStr, money(s.monthly_fee), s.group_name)))) sent.pay++;
        } else if (info.state === 'grace' && (info.grace_days_left === 5 || info.grace_days_left === 2 || info.grace_days_left === 1)) {
          if (await once(`payg:${s._id}:${endKey}:${info.grace_days_left}`, () => fanout(T.payGrace(s.full_name, info.grace_days_left, dueStr, money(s.monthly_fee), s.group_name)))) sent.pay++;
        } else if (s.status === 'blocked' || info.state === 'blocked') {
          if (await once(`blk:${s._id}:${endKey}`, () => fanout(T.accountBlocked(s.full_name, s.group_name)))) sent.pay++;
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

  return { api, send, handleUpdate, runCheck, teacherSummary, isTeacher, notifyAccountStatus };
}

module.exports = { createBot };
