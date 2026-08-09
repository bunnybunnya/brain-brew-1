const { query } = require('../config/db');

/**
 * Records an administrative action for the audit trail.
 * @param {object} params
 * @param {string} params.adminId - users.id of the acting admin
 * @param {string} params.action - e.g. 'shop.approve'
 * @param {string} [params.targetType] - e.g. 'shop', 'delivery_partner'
 * @param {string} [params.targetId]
 * @param {object} [params.details]
 * @param {string} [params.ipAddress]
 */
async function recordAuditLog({ adminId, action, targetType, targetId, details, ipAddress }) {
  await query(
    `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, ipAddress || null]
  );
}

module.exports = { recordAuditLog };
