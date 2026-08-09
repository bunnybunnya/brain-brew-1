const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Signup: request OTP -> verify OTP & create account
router.post('/signup/request-otp', authLimiter, authController.requestSignupOtp);
router.post('/signup/verify-otp', authLimiter, authController.verifySignupOtp);

// Login: password check -> OTP -> token
router.post('/login/request-otp', authLimiter, authController.requestLoginOtp);
router.post('/login/verify-otp', authLimiter, authController.verifyLoginOtp);

router.post('/otp/resend', authLimiter, authController.resendOtp);

router.get('/me', authenticate, authController.me);

module.exports = router;
