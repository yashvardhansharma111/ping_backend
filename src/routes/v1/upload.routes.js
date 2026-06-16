const router = require('express').Router();
const multer = require('multer');
const { authUser } = require('../../middleware/auth');
const uploadController = require('../../controllers/uploadController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// POST /api/v1/upload/image   (multipart field: "image", optional body field: "folder")
router.post('/image', authUser, upload.single('image'), uploadController.uploadImage);

module.exports = router;
