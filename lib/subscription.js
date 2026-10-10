/**
 * Oylik obuna qoidalari (bitta joyda).
 *
 *  - Obuna TAQVIM OYI oxirigacha to'lanadi (28/29/30/31 — oyning haqiqiy oxirgi kuni, 23:59:59 Toshkent vaqti).
 *  - Muddat tugagach GRACE_DAYS (5) kun to'lov uchun vaqt beriladi: dars ochiq, lekin ogohlantirish chiqadi.
 *  - Grace ham tugasa — avtomatik blok (faqat o'qituvchi/admin ochadi).
 *
 * O'zbekistonda yozgi/qishki vaqt yo'q: UTC+5 doimiy.
 */
const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 5;

/** `now` turgan oydan monthsAhead oy keyingi oyning OXIRGI lahzasi (Toshkent vaqti bo'yicha) */
function endOfMonth(now = new Date(), monthsAhead = 0) {
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + monthsAhead + 1; // keyingi oyning 1-kuni
  return new Date(Date.UTC(y, m, 1) - TZ_OFFSET_MS - 1);
}

/** 'YYYY-MM-DD' -> shu kunning oxiri (Toshkent). Noto'g'ri bo'lsa null */
function endOfLocalDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d + 1) - TZ_OFFSET_MS - 1);
  // 2026-02-31 kabi mavjud bo'lmagan sanalarni rad etamiz
  const back = new Date(t.getTime() + TZ_OFFSET_MS);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

const graceEnd = (end) => new Date(new Date(end).getTime() + GRACE_DAYS * DAY_MS);

/**
 * state: 'paid' (muddat ichida) | 'grace' (muddat tugagan, 5 kun vaqt) | 'blocked'
 */
function subscriptionInfo(user, now = new Date()) {
  const end = user.subscription_end_date ? new Date(user.subscription_end_date) : null;
  const gEnd = end ? graceEnd(end) : null;
  let state = 'paid';
  if (user.status === 'blocked') state = 'blocked';
  else if (end && now > gEnd) state = 'blocked';
  else if (end && now > end) state = 'grace';

  return {
    state,
    end_date: end,
    days_left: end && state === 'paid' ? Math.max(0, Math.ceil((end - now) / DAY_MS)) : 0,
    grace_ends_at: state === 'grace' ? gEnd : null,
    grace_days_left: state === 'grace' ? Math.max(0, Math.ceil((gEnd - now) / DAY_MS)) : 0,
  };
}

module.exports = { GRACE_DAYS, DAY_MS, TZ_OFFSET_MS, endOfMonth, endOfLocalDay, graceEnd, subscriptionInfo };
