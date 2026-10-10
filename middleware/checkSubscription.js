const User = require('../models/User');
const { graceEnd } = require('../lib/subscription');

/**
 * Obuna holatini tekshiradi va kerak bo'lsa AVTOMATIK bloklaydi.
 * Qaytaradi: true  -> foydalanuvchi darslarga kira oladi
 *            false -> bloklangan (user.status 'blocked' qilib saqlangan)
 *
 * Blokdan chiqarish bu yerda HECH QACHON bo'lmaydi — faqat Admin (adminController.unblockStudent).
 */
async function evaluateSubscription(user) {
  if (user.status === 'blocked') return false;

  // Muddat tugagach 5 kun to'lov muddati (grace) — shu vaqt ichida dars ochiq. Undan keyin blok.
  if (user.subscription_end_date && graceEnd(user.subscription_end_date) < new Date()) {
    // Atomik: parallel so'rovlarda ham bir marta yoziladi va hech narsa "qaytib" ochilmaydi
    await User.updateOne({ _id: user._id, status: 'active' }, { $set: { status: 'blocked' } });
    user.status = 'blocked';
    return false;
  }
  return true;
}

function blockedBody(user) {
  return {
    message: "Obunangiz faol emas. Iltimos, administrator bilan bog'laning.",
    blocked: true,
    subscription_end_date: user.subscription_end_date,
  };
}

/** Express middleware: 'protect' dan KEYIN qo'yiladi. Bloklangan bo'lsa 403 qaytaradi. */
const checkSubscription = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Avtorizatsiya talab qilinadi' });

    const ok = await evaluateSubscription(req.user);
    if (!ok) return res.status(403).json(blockedBody(req.user));
    next();
  } catch (error) {
    console.error('checkSubscription xatosi:', error);
    return res.status(500).json({ message: 'Server xatosi (obuna tekshiruvida)' });
  }
};

module.exports = checkSubscription;
module.exports.evaluateSubscription = evaluateSubscription;
module.exports.blockedBody = blockedBody;
