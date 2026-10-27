const express = require('express');
const router = express.Router();
const { registerStudent, login, changePassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.get('/groups', require('../controllers/groupController').publicGroups);
router.post('/register', registerStudent);
router.post('/login', login);
router.post('/change-password', protect, changePassword);

module.exports = router;
