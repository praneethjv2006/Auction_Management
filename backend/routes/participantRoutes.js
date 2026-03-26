const express = require('express');
const router = express.Router();
const participantController = require('../controllers/participantController');

router.post('/login', participantController.loginParticipant);
router.post('/forgot-room', participantController.forgotRoomId);

module.exports = router;
