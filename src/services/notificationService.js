const https = require('https');

// In-memory rate-limit for "nearby" notifications: one per user per 30 min
const nearbyNotifiedAt = new Map();

async function sendPush(token, { title, body, data = {}, sound = 'default' }) {
  if (!token) return;
  const payload = JSON.stringify({ to: token, title, body, data, sound, priority: 'high' });
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'exp.host',
        path: '/--/api/v2/push/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      (res) => { res.resume(); resolve(); },
    );
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

// Look up a user's Expo push token and fire a notification (fire-and-forget safe)
async function notifyUser(userId, notification) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId).select('expoPushToken');
    if (user?.expoPushToken) await sendPush(user.expoPushToken, notification);
  } catch (_) {}
}

// Notify multiple users — errors are swallowed individually
async function notifyMany(userIds, notification) {
  await Promise.all(userIds.map((id) => notifyUser(id, notification)));
}

function canSendNearby(userId) {
  const key = String(userId);
  const last = nearbyNotifiedAt.get(key);
  if (!last) return true;
  return Date.now() - last > 30 * 60 * 1000; // 30-minute cooldown
}

function markNearbySent(userId) {
  nearbyNotifiedAt.set(String(userId), Date.now());
}

module.exports = { sendPush, notifyUser, notifyMany, canSendNearby, markNearbySent };
