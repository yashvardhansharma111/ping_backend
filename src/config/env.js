const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

function readEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length && process.env.NODE_ENV !== 'test') {
    console.warn(`[env] missing required vars: ${missing.join(', ')} — copy .env.example to .env`);
  }

  const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3000', 10),
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',

    MONGODB_URI: process.env.MONGODB_URI || '',
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'ping',

    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
    JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL || '15m',
    JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL || '30d',

    OTP_DEBUG: process.env.OTP_DEBUG === 'true',
    OTP_LENGTH: parseInt(process.env.OTP_LENGTH || '6', 10),
    OTP_TTL_SECONDS: parseInt(process.env.OTP_TTL_SECONDS || '300', 10),
    OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    OTP_REQUEST_COOLDOWN_SECONDS: parseInt(process.env.OTP_REQUEST_COOLDOWN_SECONDS || '30', 10),

    SMS_PROVIDER: process.env.SMS_PROVIDER || 'stub',
    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY || '',
    MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID || '',
    MSG91_SENDER_ID: process.env.MSG91_SENDER_ID || 'PINGAPP',

    CORS_ALLOWED_ORIGINS: (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  };

  env.isProd = env.NODE_ENV === 'production';
  env.isDev = env.NODE_ENV === 'development';
  env.isTest = env.NODE_ENV === 'test';
  return env;
}

module.exports = readEnv();
