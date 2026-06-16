const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const env = require('../config/env');

let _client = null;

function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/**
 * Upload a buffer to R2.
 * @param {string} key - Object key (path inside bucket), e.g. "users/abc123/avatar.jpg"
 * @param {Buffer} buffer - File content
 * @param {string} contentType - MIME type, e.g. "image/jpeg"
 * @returns {Promise<string>} Public CDN URL
 */
async function uploadBuffer(key, buffer, contentType) {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Delete an object from R2 by its public URL (no-op if URL is empty/external).
 */
async function deleteByUrl(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith(env.R2_PUBLIC_URL)) return;
  const key = publicUrl.slice(env.R2_PUBLIC_URL.length + 1); // strip leading slash
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })).catch(() => {});
}

module.exports = { uploadBuffer, deleteByUrl };
