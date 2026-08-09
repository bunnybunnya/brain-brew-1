const { verifyToken } = require('../utils/jwt');
const { query } = require('../config/db');

/**
 * Verifies the JWT on every protected request and attaches req.user.
 * Also re-checks the account's live status in the DB (not just the
 * token claims) so a suspended/disabled account is blocked immediately
 * even if their token hasn't expired yet.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const decoded = verifyToken(token);

    const { rows } = await query(
      `SELECT id, role, status, mobile_verified, email_verified FROM users WHERE id = $1`,
      [decoded.userId]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid session.' });
    }
    const user = rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: `Account is ${user.status}.` });
    }

    req.user = {
      id: user.id,
      role: user.role,
      mobileVerified: user.mobile_verified,
      emailVerified: user.email_verified,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { authenticate };
