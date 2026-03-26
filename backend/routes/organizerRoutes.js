const express = require('express');
const router = express.Router();
const organizerController = require('../controllers/organizerController');

router.get('/test', organizerController.getTest);
router.get('/', organizerController.getOrganizer);
router.post('/login', organizerController.loginOrganizer);
router.post('/signup/request-otp', organizerController.requestSignupOtp);
router.post('/signup/verify-otp', organizerController.verifySignupOtp);
router.post('/forgot-id', organizerController.forgotOrganizerId);

module.exports = router;
