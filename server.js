require('dotenv').config();

const env = require('./src/config/env');
const { connectDB, disconnectDB } = require('./src/config/db');
const buildApp = require('./src/app');

async function main() {
  await connectDB();
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
