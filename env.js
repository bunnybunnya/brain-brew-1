require('dotenv').config();

function required(name, fallback = undefined) {
  const val = process.env[name] ?? fallback;
  return val;
}

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'Meat Delivery Marketplace',

  db: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),

  otp: {
    providerName: process.env.OTP_PROVIDER_NAME || '',
    apiKey: process.env.OTP_PROVIDER_API_KEY || '',
    senderId: process.env.OTP_PROVIDER_SENDER_ID || '',
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '30', 10),
  },

  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localUploadDir: process.env.LOCAL_UPLOAD_DIR || './uploads/private',
    maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '5', 10),
  },

  business: {
    deliveryBaseCharge: parseFloat(process.env.DELIVERY_BASE_CHARGE || '0'),
    taxPercent: parseFloat(process.env.TAX_PERCENT || '0'),
    dpEarningPerOrder: parseFloat(process.env.DELIVERY_PARTNER_EARNING_PER_ORDER || '0'),
  },
};
