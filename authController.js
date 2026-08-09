const { query, getClient } = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { issueOtp, verifyOtp } = require('../utils/otp');

function isEmail(identifier) {
  return identifier.includes('@');
}

/**
 * STEP 1 of signup (all roles): validate input, ensure mobile/email not
 * already used, then send an OTP. The account itself is only created
 * once the OTP is verified (see verifySignupOtp).
 */
async function requestSignupOtp(req, res, next) {
  try {
    const { mobile, email } = req.body;
    const identifier = mobile || email;
    if (!identifier) {
      return res.status(400).json({ error: 'Mobile number or email is required.' });
    }

    const existing = await query(
      `SELECT id FROM users WHERE mobile = $1 OR email = $2`,
      [mobile || null, email || null]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this mobile/email already exists. Please login.' });
    }

    const { expiresAt } = await issueOtp({ identifier, purpose: 'signup' });
    res.json({ message: 'OTP sent.', expiresAt });
  } catch (err) {
    next(err);
  }
}

/**
 * STEP 2 of signup: verify the OTP, then create the user + role-specific
 * profile row in a single transaction. `role` must be one of
 * customer | shop_owner | delivery_partner (admins are created separately,
 * never via public signup).
 */
async function verifySignupOtp(req, res, next) {
  const client = await getClient();
  try {
    const { role, name, mobile, email, password, otp } = req.body;

    if (!['customer', 'shop_owner', 'delivery_partner'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (!name || !password || (!mobile && !email) || !otp) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const identifier = mobile || email;
    await verifyOtp({ identifier, purpose: 'signup', submittedOtp: otp });

    const passwordHash = await hashPassword(password);

    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (role, name, mobile, email, password_hash, mobile_verified, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, role, name, mobile, email`,
      [
        role,
        name,
        mobile || null,
        email || null,
        passwordHash,
        Boolean(mobile),
        Boolean(email),
      ]
    );
    const user = userResult.rows[0];

    if (role === 'customer') {
      await client.query(`INSERT INTO customers (user_id) VALUES ($1)`, [user.id]);
    } else if (role === 'shop_owner') {
      await client.query(`INSERT INTO shop_owners (user_id) VALUES ($1)`, [user.id]);
    } else if (role === 'delivery_partner') {
      // status defaults to 'pending' - cannot accept deliveries until admin approval
      await client.query(`INSERT INTO delivery_partners (user_id) VALUES ($1)`, [user.id]);
    }

    await client.query('COMMIT');

    const token = signToken({ userId: user.id, role: user.role });
    res.status(201).json({ token, user });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * STEP 1 of login: verify mobile/email + password, then send OTP.
 * Does not issue a token yet.
 */
async function requestLoginOtp(req, res, next) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required.' });
    }

    const field = isEmail(identifier) ? 'email' : 'mobile';
    const { rows } = await query(`SELECT * FROM users WHERE ${field} = $1`, [identifier]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: `Account is ${user.status}. Contact support.` });
    }

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const { expiresAt } = await issueOtp({ identifier, purpose: 'login' });
    res.json({ message: 'OTP sent.', expiresAt });
  } catch (err) {
    next(err);
  }
}

/**
 * STEP 2 of login: verify OTP, then issue JWT.
 * Delivery partners who are not yet approved still get a token
 * (so they can see their approval status screen) but role-scoped
 * routes must separately check dp.status === 'approved' before
 * allowing dashboard actions - see requireApprovedDeliveryPartner.
 */
async function verifyLoginOtp(req, res, next) {
  try {
    const { identifier, otp } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Identifier and OTP are required.' });
    }

    await verifyOtp({ identifier, purpose: 'login', submittedOtp: otp });

    const field = isEmail(identifier) ? 'email' : 'mobile';
    const { rows } = await query(
      `SELECT id, role, name, mobile, email FROM users WHERE ${field} = $1`,
      [identifier]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Account not found.' });
    }
    const user = rows[0];
    const token = signToken({ userId: user.id, role: user.role });
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
}

async function resendOtp(req, res, next) {
  try {
    const { identifier, purpose } = req.body;
    if (!identifier || !['signup', 'login', 'password_reset'].includes(purpose)) {
      return res.status(400).json({ error: 'Valid identifier and purpose are required.' });
    }
    const { expiresAt } = await issueOtp({ identifier, purpose });
    res.json({ message: 'OTP resent.', expiresAt });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, role, name, mobile, email, mobile_verified, email_verified, status, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requestSignupOtp,
  verifySignupOtp,
  requestLoginOtp,
  verifyLoginOtp,
  resendOtp,
  me,
};
