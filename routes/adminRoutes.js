const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const {
  listStudents,
  unblockStudent,
  approveSpeakingExam,
  parseUnitWithAI,
  getStudentDetails,
  deleteStudent,
} = require('../controllers/adminController');

// Hamma admin marshrutlari: token (protect) + role === 'admin' (adminOnly).
router.use(protect, adminOnly);

router.get('/students', listStudents);
router.get('/students/:id', getStudentDetails);
router.delete('/students/:id', deleteStudent);
router.post('/students/:id/unblock', unblockStudent);
router.post('/students/:id/approve-speaking', approveSpeakingExam);
router.post('/parse-unit', parseUnitWithAI);

module.exports = router;
