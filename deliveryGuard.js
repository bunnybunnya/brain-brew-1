const { query } = require('../config/db');

/**
 * Extra guard for delivery-partner dashboard actions: confirms the
 * partner is approved (and, where required, online) before allowing
 * access. Pending/rejected/suspended partners never reach these routes,
 * even though they can log in to see their status screen.
 */
function requireApprovedDeliveryPartner({ mustBeOnline = false } = {}) {
  return async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT status, is_online FROM delivery_partners WHERE user_id = $1`,
        [req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Delivery partner profile not found.' });
      const dp = rows[0];
      if (dp.status !== 'approved') {
        return res.status(403).json({ error: `Your account is ${dp.status}. You cannot access the delivery dashboard yet.` });
      }
      if (mustBeOnline && !dp.is_online) {
        return res.status(403).json({ error: 'Go online to see or accept deliveries.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireApprovedDeliveryPartner };
