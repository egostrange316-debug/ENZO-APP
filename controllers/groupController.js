/** Guruhlar boshqaruvi (admin): yaratish, nomini o'zgartirish, o'chirish, o'quvchilarni ko'chirish. */
const mongoose = require('mongoose');
const Group = require('../models/Group');
const User = require('../models/User');
const G = require('../lib/groups');

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { console.error('groupController xatosi:', e); res.status(500).json({ message: 'Server xatosi' }); }
};

/** GET /api/auth/groups — ro'yxatdan o'tish uchun ochiq ro'yxat (faqat nomlar) */
const publicGroups = wrap(async (req, res) => { res.status(200).json({ groups: await G.groupNames() }); });

/** GET /api/admin/groups */
const adminGroups = wrap(async (req, res) => { res.status(200).json(await G.groupsWithCounts()); });

/** POST /api/admin/groups { name } */
const createGroup = wrap(async (req, res) => {
  const name = G.cleanName(req.body?.name);
  if (name.length < 2) return res.status(400).json({ message: "Guruh nomi kamida 2 ta belgi bo'lsin" });
  await G.listGroups();
  if (await Group.findOne({ name_key: Group.keyOf(name) })) return res.status(409).json({ message: 'Bunday guruh bor' });
  const last = await Group.findOne().sort({ order: -1 }).lean();
  await Group.create({ name, name_key: Group.keyOf(name), order: (last?.order ?? -1) + 1 });
  res.status(201).json(await G.groupsWithCounts());
});

/** PATCH /api/admin/groups/:id { name } — o'quvchilardagi nom ham almashadi */
const renameGroup = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Guruh topilmadi' });
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Guruh topilmadi' });
  const name = G.cleanName(req.body?.name);
  if (name.length < 2) return res.status(400).json({ message: "Guruh nomi kamida 2 ta belgi bo'lsin" });
  const clash = await Group.findOne({ name_key: Group.keyOf(name), _id: { $ne: g._id } });
  if (clash) return res.status(409).json({ message: 'Bunday guruh bor' });
  const old = g.name;
  g.name = name; g.name_key = Group.keyOf(name);
  await g.save();
  if (old !== name) await User.updateMany({ role: 'student', group_name: old }, { $set: { group_name: name } });
  res.status(200).json(await G.groupsWithCounts());
});

/** DELETE /api/admin/groups/:id?move_to=<guruh nomi> — o'quvchilar ko'chiriladi (move_to yo'q bo'lsa guruhsiz bo'ladi) */
const deleteGroup = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Guruh topilmadi' });
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Guruh topilmadi' });
  const target = req.query.move_to ? String(req.query.move_to) : null;
  if (target && (target === g.name || !(await G.isValidGroup(target)))) return res.status(400).json({ message: "Ko'chiriladigan guruh noto'g'ri" });
  await User.updateMany({ role: 'student', group_name: g.name }, { $set: { group_name: target } });
  await g.deleteOne();
  res.status(200).json(await G.groupsWithCounts());
});

/** POST /api/admin/groups/move { student_ids: [...], to: 'guruh nomi' | '' } — bir yoki bir nechta o'quvchini ko'chirish */
const moveStudents = wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.student_ids) ? req.body.student_ids.map(String) : [];
  if (!ids.length || ids.length > 200 || !ids.every((i) => mongoose.isValidObjectId(i))) return res.status(400).json({ message: "O'quvchilar ro'yxati noto'g'ri" });
  const to = String(req.body?.to ?? '').trim();
  if (to && !(await G.isValidGroup(to))) return res.status(400).json({ message: "Guruh noto'g'ri" });
  const r = await User.updateMany({ _id: { $in: ids }, role: 'student' }, { $set: { group_name: to || null } });
  res.status(200).json({ moved: r.modifiedCount ?? r.nModified ?? 0, ...(await G.groupsWithCounts()) });
});

module.exports = { publicGroups, adminGroups, createGroup, renameGroup, deleteGroup, moveStudents };
