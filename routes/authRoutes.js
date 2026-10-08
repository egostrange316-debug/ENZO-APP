const express = require('express');
const router = express.Router();
const { registerStudent, login } = require('../controllers/authController');

router.post('/register', registerStudent);
router.post('/login', login);

module.exports = router;
