const { query } = require('../config/db');

/**
 * Generates the next sequential Delivery Partner ID, e.g. DP-000001.
 * Uses the count of already-assigned dp_codes so it's always unique
 * and never hard-coded.
 */
async function generateDeliveryPartnerId() {
  const { rows } = await query(
    `SELECT dp_code FROM delivery_partners
     WHERE dp_code IS NOT NULL
     ORDER BY dp_code DESC LIMIT 1`
  );
  let nextNumber = 1;
  if (rows.length > 0) {
    const lastCode = rows[0].dp_code; // e.g. DP-000042
    const lastNumber = parseInt(lastCode.split('-')[1], 10);
    nextNumber = lastNumber + 1;
  }
  return `DP-${String(nextNumber).padStart(6, '0')}`;
}

/**
 * Generates a human-readable order number, e.g. ORD-20260809-000123.
 */
async function generateOrderNumber() {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM orders WHERE order_number LIKE $1`,
    [`ORD-${datePart}-%`]
  );
  const seq = (rows[0].count || 0) + 1;
  return `ORD-${datePart}-${String(seq).padStart(6, '0')}`;
}

module.exports = { generateDeliveryPartnerId, generateOrderNumber };
