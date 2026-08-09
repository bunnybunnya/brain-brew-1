const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const env = require('../config/env');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// ---------------------------------------------------------------
// STORAGE_DRIVER=local (dev only): writes to a private, non-served
// folder on disk. This folder is NEVER mounted as a static/public
// route in app.js - files are only reachable through an authenticated
// admin-only download endpoint (see routes/admin.routes.js).
//
// For production, replace this with a driver that uploads to private
// S3/GCS-compatible object storage and returns a storage key instead
// of a local path (e.g. using @aws-sdk/client-s3 with a bucket that
// has public access blocked, plus signed URLs for admin viewing).
// ---------------------------------------------------------------

if (env.storage.driver === 'local') {
  fs.mkdirSync(env.storage.localUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, env.storage.localUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new Error('Unsupported file type. Only JPEG, PNG, WEBP, or PDF allowed.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.storage.maxUploadMb * 1024 * 1024 },
});

module.exports = { upload };
