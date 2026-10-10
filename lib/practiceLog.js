const PracticeItem = require('../models/PracticeItem');

const CLEAR_STREAK = Math.max(1, Number(process.env.PRACTICE_CLEAR_STREAK) || 2);

/**
 * Xato javob -> "Mashq"ga avtomatik tushadi (yoki qaytadan faol bo'ladi). Hech qachon asosiy oqimni buzmasligi kerak:
 * xato bo'lsa jim o'tadi (mashq bo'limi qo'shimcha, darsdan muhimroq emas).
 */
async function recordMistake(userId, day, key) {
  try {
    await PracticeItem.updateOne(
      { user: userId, day_number: day, key },
      { $set: { status: 'active', streak: 0, last_at: new Date() }, $unset: { done_at: '' }, $inc: { wrong_total: 1 }, $setOnInsert: { added_at: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    if (!(e && e.code === 11000)) console.error('recordMistake xatosi:', e.message);
  }
}

module.exports = { recordMistake, CLEAR_STREAK };
