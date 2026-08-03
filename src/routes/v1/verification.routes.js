const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authUser } = require('../../middleware/auth');
const verificationController = require('../../controllers/verificationController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// POST /api/v1/verification/request  — user submits selfie for verification
router.post('/request', authUser, upload.single('selfie'), verificationController.requestVerification);

// GET  /api/v1/verification/status   — get current verification status
router.get('/status', authUser, verificationController.getVerificationStatus);

module.exports = router;
