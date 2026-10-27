/** Guruhlar: bazadagi ro'yxat. Bo'sh bo'lsa, eski 5 guruh bilan to'ldiriladi (bir marta). */
const Group = require('../models/Group');
const User = require('../models/User');

const DEFAULT_GROUPS = ['1-guruh', '2-guruh', '3-guruh', '4-guruh', 'Qizlar guruhi'];
const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

async function listGroups() {
  if ((await Group.estimatedDocumentCount()) === 0) {
    await Group.insertMany(DEFAULT_GROUPS.map((name, i) => ({ name, name_key: Group.keyOf(name), order: i })), { ordered: false }).catch(() => {});
  }
  return Group.find().sort({ order: 1, name: 1 }).lean();
}
async function groupNames() { return (await listGroups()).map((g) => g.name); }
async function isValidGroup(name) { return (await groupNames()).includes(name); }

/** Guruhlar + har birida nechta o'quvchi (guruhsiz ham sanaladi) */
async function groupsWithCounts() {
  const [groups, counts] = await Promise.all([listGroups(), User.aggregate([{ $match: { role: 'student' } }, { $group: { _id: '$group_name', n: { $sum: 1 } } }])]);
  const by = new Map(counts.map((c) => [c._id || '', c.n]));
  return { groups: groups.map((g) => ({ id: g._id, name: g.name, students: by.get(g.name) || 0 })), ungrouped: by.get('') || 0 };
}

module.exports = { DEFAULT_GROUPS, cleanName, listGroups, groupNames, isValidGroup, groupsWithCounts };
