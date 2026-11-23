const FocusLog = require('../models/FocusLog');
const User = require('../models/User');
const { tashkentNow, validDate } = require('../lib/dayStatus');

function clampInt(v, min, max) {
  const n = Math.round(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}

function cleanAppList(raw, defaultKind = 'app') {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({
      name: a.name.trim().slice(0, 60),
      pkg: String(a.pkg || '').trim().slice(0, 120),
      minutes: clampInt(a.minutes, 0, 1440),
      kind: a.kind === 'game' ? 'game' : defaultKind,
    }))
    .filter((a) => a.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);
}

function computeFocusScore({ studyMinutes, distractMinutes, leftCount }) {
  let score = 100;
  if (distractMinutes > 0) {
    const ratio = distractMinutes / Math.max(15, studyMinutes + distractMinutes);
    score -= Math.round(ratio * 45);
  }
  score -= Math.min(25, leftCount * 5);
  if (studyMinutes >= 20) score += 10;
  return Math.max(10, Math.min(100, score));
}

exports.getFocus = async (req, res) => {
  try {
    const date = validDate(req.query.date) ? req.query.date : tashkentNow().date;
    const doc = await FocusLog.findOne({ user: req.user._id, date }).lean();
    res.status(200).json({ focus: doc || null, date });
  } catch (e) {
    console.error('getFocus xatosi:', e.message);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

exports.putFocus = async (req, res) => {
  try {
    const date = validDate(req.body?.date) ? req.body.date : tashkentNow().date;
    const studyMinutes = clampInt(req.body?.study_minutes, 0, 1440);
    const gamesMinutes = clampInt(req.body?.games_minutes, 0, 1440);
    const otherAppsMinutes = clampInt(req.body?.other_apps_minutes, 0, 1440);
    const leftCount = clampInt(req.body?.left_count, 0, 500);
    const usageAccess = Boolean(req.body?.usage_access);
    const topGames = cleanAppList(req.body?.top_games, 'game');
    const topApps = cleanAppList(req.body?.top_apps, 'app');
    const allTop = cleanAppList(req.body?.all_top, 'app');
    const totalDistract = clampInt(
      req.body?.total_distract_minutes ?? gamesMinutes + otherAppsMinutes,
      0,
      1440
    );

    const existing = await FocusLog.findOne({ user: req.user._id, date });
    const mergedStudy = Math.max(existing?.study_minutes || 0, studyMinutes);
    const mergedGames = usageAccess ? Math.max(existing?.games_minutes || 0, gamesMinutes) : existing?.games_minutes || 0;
    const mergedOther = usageAccess ? Math.max(existing?.other_apps_minutes || 0, otherAppsMinutes) : existing?.other_apps_minutes || 0;
    const mergedDistract = usageAccess ? Math.max(existing?.total_distract_minutes || 0, totalDistract) : existing?.total_distract_minutes || 0;
    const mergedLeft = Math.max(existing?.left_count || 0, leftCount);

    const focusScore = computeFocusScore({
      studyMinutes: mergedStudy,
      distractMinutes: mergedDistract,
      leftCount: mergedLeft,
    });

    const doc = await FocusLog.findOneAndUpdate(
      { user: req.user._id, date },
      {
        $set: {
          study_minutes: mergedStudy,
          games_minutes: mergedGames,
          other_apps_minutes: mergedOther,
          total_distract_minutes: mergedDistract,
          left_count: mergedLeft,
          usage_access: usageAccess,
          top_games: usageAccess && topGames.length ? topGames : existing?.top_games || [],
          top_apps: usageAccess && topApps.length ? topApps : existing?.top_apps || [],
          all_top: usageAccess && allTop.length ? allTop : existing?.all_top || [],
          focus_score: focusScore,
        },
      },
      { upsert: true, new: true }
    ).lean();

    res.status(200).json({ focus: doc });

    // Real-vaqt 15+ daqiqa o'yin / boshqa platforma ogohlantirishi (ota-onaga fon rejimida)
    if (process.env.TELEGRAM_BOT_TOKEN && usageAccess && mergedDistract >= 15) {
      setImmediate(async () => {
        try {
          const { buildBot } = require('../routes/telegramRoutes');
          const student = await User.findById(req.user._id)
            .select('full_name group_name excused_dates createdAt parent_chats status')
            .lean();
          if (student && Array.isArray(student.parent_chats) && student.parent_chats.length) {
            await buildBot().checkDistractionAlert(student, doc);
          }
        } catch (_) {}
      });
    }
  } catch (e) {
    console.error('putFocus xatosi:', e.message);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

exports.popPraise = async (req, res) => {
  try {
    const docs = await FocusLog.find({ user: req.user._id, pending_praise: { $gt: 0 } });
    let count = 0;
    for (const d of docs) {
      count += d.pending_praise || 0;
      d.pending_praise = 0;
      await d.save();
    }
    if (count > 0) {
      await User.updateOne({ _id: req.user._id }, { $inc: { xp: count * 10 } }).catch(() => {});
    }
    res.status(200).json({ count, bonus_xp: count * 10 });
  } catch (e) {
    console.error('popPraise xatosi:', e.message);
    res.status(500).json({ message: 'Server xatosi' });
  }
};
