const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);
mongoose.set('id', false);

let connecting = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 20,
      autoIndex: !env.isProd,
    })
    .then((m) => {
      console.log(`[db] connected to ${m.connection.name} on ${m.connection.host}`);
      return m.connection;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });

  mongoose.connection.on('error', (err) => console.error('[db] error', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));

  return connecting;
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDB, disconnectDB, mongoose };
