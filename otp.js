const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { query } = require('../config/db');

function generateNumericOtp(length) {
  const digits = '0123456789';
  let otp = '';
  // crypto.randomInt avoids modulo bias vs Math.random()
  for (let i = 0; i < length; i += 1) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}

/**
 * Sends the OTP through your configured SMS/Email provider.
 *
 * ==> PLUG IN YOUR OWN CREDENTIALS <==
 * Set OTP_PROVIDER_NAME / OTP_PROVIDER_API_KEY / OTP_PROVIDER_SENDER_ID
 * in .env, then implement the actual HTTP call to your provider below
 * (MSG91, Twilio Verify, 2Factor, AWS SNS, etc. all work the same way:
 * POST the identifier + otp/message to their API using apiKey as auth).
 *
 * This function intentionally does NOT fabricate a "success" response -
 * if you haven't implemented a provider yet, it throws so the failure
 * is obvious instead of silently pretending an OTP was sent.
 */
async function sendOtpViaProvider({ identifier, otp, channel }) {
  if (!env.otp.apiKey) {
    throw new Error(
      'OTP provider not configured. Set OTP_PROVIDER_API_KEY (and related OTP_* vars) in .env, ' +
      'then implement the provider call in src/utils/otp.js:sendOtpViaProvider().'
    );
  }

  // Example shape (replace with your provider's real request):
  //
  // const res = await fetch(`https://api.${env.otp.providerName}.com/otp/send`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.otp.apiKey}` },
  //   body: JSON.stringify({ to: identifier, otp, sender: env.otp.senderId, channel }),
  // });
  // if (!res.ok) throw new Error(`OTP provider error: ${res.status}`);
  // return res.json();

  throw new Error(
    'sendOtpViaProvider() is a stub - implement the real API call for your OTP provider here.'
  );
}

/**
 * Creates and "sends" an OTP for a given identifier + purpose.
 * Enforces resend cooldown. Stores only a bcrypt hash of the OTP.
 */
async function issueOtp({ identifier, purpose }) {
  const cooldownRow = await query(
    `SELECT last_sent_at FROM otp_verifications
     WHERE identifier = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (cooldownRow.rows.length > 0) {
    const lastSentAt = new Date(cooldownRow.rows[0].last_sent_at);
    const secondsSince = (Date.now() - lastSentAt.getTime()) / 1000;
    if (secondsSince < env.otp.resendCooldownSeconds) {
      const wait = Math.ceil(env.otp.resendCooldownSeconds - secondsSince);
      const err = new Error(`Please wait ${wait}s before requesting another OTP.`);
      err.statusCode = 429;
      throw err;
    }
  }

  const otp = generateNumericOtp(env.otp.length);
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + env.otp.expiryMinutes * 60 * 1000);
  const channel = identifier.includes('@') ? 'email' : 'sms';

  await query(
    `INSERT INTO otp_verifications (identifier, purpose, otp_hash, max_attempts, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [identifier, purpose, otpHash, env.otp.maxAttempts, expiresAt]
  );

  await sendOtpViaProvider({ identifier, otp, channel });

  return { expiresAt };
}

/**
 * Verifies a submitted OTP against the most recent unconsumed record
 * for that identifier + purpose. Enforces expiry and attempt limits.
 */
async function verifyOtp({ identifier, purpose, submittedOtp }) {
  const { rows } = await query(
    `SELECT * FROM otp_verifications
     WHERE identifier = $1 AND purpose = $2 AND consumed = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (rows.length === 0) {
    const err = new Error('No OTP request found. Please request a new OTP.');
    err.statusCode = 400;
    throw err;
  }

  const record = rows[0];

  if (new Date(record.expires_at) < new Date()) {
    const err = new Error('OTP has expired. Please request a new one.');
    err.statusCode = 400;
    throw err;
  }

  if (record.attempts >= record.max_attempts) {
    const err = new Error('Maximum OTP attempts exceeded. Please request a new OTP.');
    err.statusCode = 429;
    throw err;
  }

  const isMatch = await bcrypt.compare(submittedOtp, record.otp_hash);

  await query(
    `UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`,
    [record.id]
  );

  if (!isMatch) {
    const err = new Error('Incorrect OTP.');
    err.statusCode = 400;
    throw err;
  }

  await query(`UPDATE otp_verifications SET consumed = TRUE WHERE id = $1`, [record.id]);
  return true;
}

module.exports = { issueOtp, verifyOtp };
