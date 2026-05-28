require('dotenv').config();

const env = require('./src/config/env');
const { connectDB, disconnectDB, mongoose } = require('./src/config/db');
const buildApp = require('./src/app');

// Drop stale email_1 / username_1 indexes so Mongoose can recreate them correctly.
// These were created without partialFilterExpression, which caused null-value conflicts.
async function dropStaleIndexes() {
  const User = require('./src/models/User');
  for (const name of ['email_1', 'username_1']) {
    try {
      await User.collection.dropIndex(name);
      console.log(`[db] dropped stale ${name} index — will be recreated correctly`);
    } catch (e) {
      // 27 = IndexNotFound — already gone, nothing to do
      if (e.code !== 27 && e.codeName !== 'IndexNotFound') {
        console.warn(`[db] could not drop ${name}:`, e.message);
      }
    }
  }
}

async function main() {
  await connectDB();
  await dropStaleIndexes();
  const app = buildApp();

  const server = app.listen(env.PORT, () => {
    console.log(`[ping] api listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal) => {
    console.log(`[ping] ${signal} received, shutting down`);
    server.close(() => {});
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[ping] fatal startup error', err);
  process.exit(1);
});
