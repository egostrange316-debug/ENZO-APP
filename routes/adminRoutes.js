const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const {
  listStudents,
  unblockStudent,
  recordPayment,
  recordCyclePayment,
  cancelLastPayment,
  setBilling,
  approveSpeakingExam,
  parseUnitWithAI,
  getStudentDetails,
  deleteStudent,
  studentCard,
  passCurrentDay,
  setStudentDay,
  studentWritings,
  placeStudent,
} = require('../controllers/adminController');

const { courseMap } = require('../controllers/bookPlanController');

// Hamma admin marshrutlari: token (protect) + role === 'admin' (adminOnly).
router.use(protect, adminOnly);

router.get('/students', listStudents);
router.get('/students/:id', getStudentDetails);
router.get('/students/:id/card', studentCard);
router.get('/students/:id/writings', studentWritings);
router.post('/students/:id/placement', placeStudent);
router.post('/students/:id/pass-day', passCurrentDay);
router.post('/students/:id/set-day', setStudentDay);
router.delete('/students/:id', deleteStudent);
router.post('/students/:id/pay', recordPayment);
router.post('/students/:id/payment', recordCyclePayment);
router.post('/students/:id/payment/cancel', cancelLastPayment);
router.patch('/students/:id/billing', setBilling);
router.post('/students/:id/unblock', unblockStudent);
router.post('/students/:id/approve-speaking', approveSpeakingExam);
router.post('/parse-unit', parseUnitWithAI);
router.get('/course-map', courseMap);
const teacher = require('../controllers/teacherController');
router.get('/today', teacher.todayPanel);
const sched = require('../controllers/scheduleController');
router.get('/schedule', sched.adminSchedule);
router.get('/payments', sched.paymentsTable);
const grp = require('../controllers/groupController');
router.get('/groups', grp.adminGroups);
router.post('/groups', grp.createGroup);
router.post('/groups/move', grp.moveStudents);
router.patch('/groups/:id', grp.renameGroup);
const stat = require('../controllers/statusController');
router.get('/status', stat.statusTable);
router.patch('/groups/:id/schedule', stat.setSchedule);
router.post('/groups/:id/off', stat.setOff);
router.post('/students/:id/excuse', stat.setExcuse);
router.delete('/groups/:id', grp.deleteGroup);
router.get('/books/:id/content', teacher.vocabOf);
router.patch('/books/:id/vocab', teacher.editVocab);

module.exports = router;
