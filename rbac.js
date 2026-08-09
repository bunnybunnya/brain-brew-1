/**
 * Restricts an endpoint to one or more roles. Every route that touches
 * role-specific data must use this - never rely on the frontend hiding
 * buttons/pages as the only protection.
 *
 * Usage: router.get('/admin/thing', authenticate, requireRole('admin'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' });
    }
    next();
  };
}

module.exports = { requireRole };
