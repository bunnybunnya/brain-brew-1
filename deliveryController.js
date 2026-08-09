const { query, getClient } = require('../config/db');
const env = require('../config/env');

// ---------- REGISTRATION (profile fields + document upload) ----------

async function getMyProfile(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, dp_code, date_of_birth, address_line, selfie_url, driving_licence_no, rc_number,
              vehicle_type, vehicle_number, status, status_reason, is_online, created_at
       FROM delivery_partners WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Delivery partner profile not found.' });
    res.json({ profile: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateMyProfile(req, res, next) {
  try {
    const { dateOfBirth, addressLine, drivingLicenceNo, rcNumber, vehicleType, vehicleNumber, bankAccountInfo } = req.body;

    const { rows } = await query(
      `UPDATE delivery_partners SET
         date_of_birth = COALESCE($1, date_of_birth),
         address_line = COALESCE($2, address_line),
         driving_licence_no = COALESCE($3, driving_licence_no),
         rc_number = COALESCE($4, rc_number),
         vehicle_type = COALESCE($5, vehicle_type),
         vehicle_number = COALESCE($6, vehicle_number),
         bank_account_info = COALESCE($7, bank_account_info)
       WHERE user_id = $8 RETURNING id, status`,
      [dateOfBirth || null, addressLine || null, drivingLicenceNo || null, rcNumber || null,
       vehicleType || null, vehicleNumber || null, bankAccountInfo ? JSON.stringify(bankAccountInfo) : null, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Delivery partner profile not found.' });
    res.json({ profile: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * Handles selfie / driving licence / RC uploads. Files are written to
 * private storage (see middleware/upload.js) - never a public path.
 * Expects multipart form field `docType` = selfie | driving_licence | rc
 * alongside the file field `document`.
 */
async function uploadDocument(req, res, next) {
  try {
    const { docType } = req.body;
    if (!['selfie', 'driving_licence', 'rc'].includes(docType)) {
      return res.status(400).json({ error: 'docType must be selfie, driving_licence, or rc.' });
    }
    if (!req.file) return res.status(400).json({ error: 'File is required.' });

    const dpResult = await query(`SELECT id FROM delivery_partners WHERE user_id = $1`, [req.user.id]);
    if (dpResult.rows.length === 0) return res.status(404).json({ error: 'Delivery partner profile not found.' });
    const dpId = dpResult.rows[0].id;

    // file_key stores only the server-local filename/key, never a public URL
    const fileKey = req.file.filename;

    const { rows } = await query(
      `INSERT INTO delivery_documents (delivery_partner_id, doc_type, file_key) VALUES ($1,$2,$3) RETURNING id, doc_type, uploaded_at`,
      [dpId, docType, fileKey]
    );

    if (docType === 'selfie') {
      await query(`UPDATE delivery_partners SET selfie_url = $1 WHERE id = $2`, [fileKey, dpId]);
    }

    res.status(201).json({ document: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- DASHBOARD (approved partners only - enforced by middleware) ----------

async function goOnline(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE delivery_partners SET is_online = TRUE WHERE user_id = $1 AND status = 'approved' RETURNING id, is_online`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Only approved delivery partners can go online.' });
    res.json({ profile: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function goOffline(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE delivery_partners SET is_online = FALSE WHERE user_id = $1 RETURNING id, is_online`,
      [req.user.id]
    );
    res.json({ profile: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * Orders that are ready_for_pickup and not yet claimed by any delivery
 * partner. Only reachable by approved + online partners (route middleware).
 */
async function listAvailableDeliveries(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT o.id, o.order_number, o.total_amount, o.status, s.name AS shop_name, s.address_line AS shop_address, s.phone AS shop_phone,
              a.address_line AS delivery_address, a.city
       FROM orders o
       JOIN shops s ON s.id = o.shop_id
       JOIN addresses a ON a.id = o.delivery_address_id
       WHERE o.status = 'ready_for_pickup' AND o.delivery_partner_id IS NULL
       ORDER BY o.updated_at ASC`
    );
    res.json({ availableDeliveries: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Claims a delivery. Uses SELECT ... FOR UPDATE + a status/null check
 * inside a transaction so two partners racing to accept the same order
 * can't both succeed - whichever transaction commits first wins, and the
 * order then disappears from other partners' available list.
 */
async function acceptDelivery(req, res, next) {
  const client = await getClient();
  try {
    const dpResult = await query(`SELECT id, status FROM delivery_partners WHERE user_id = $1`, [req.user.id]);
    if (dpResult.rows.length === 0 || dpResult.rows[0].status !== 'approved') {
      return res.status(403).json({ error: 'Only approved delivery partners can accept deliveries.' });
    }
    const dpId = dpResult.rows[0].id;

    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND status = 'ready_for_pickup' AND delivery_partner_id IS NULL FOR UPDATE`,
      [req.params.orderId]
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This delivery is no longer available.' });
    }

    await client.query(
      `UPDATE orders SET status = 'assigned', delivery_partner_id = $1 WHERE id = $2`,
      [dpId, req.params.orderId]
    );
    const deliveryResult = await client.query(
      `INSERT INTO deliveries (order_id, delivery_partner_id, status) VALUES ($1,$2,'assigned') RETURNING *`,
      [req.params.orderId, dpId]
    );

    await client.query('COMMIT');
    res.status(201).json({ delivery: deliveryResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function getMyDeliveryId(userId) {
  const dp = await query(`SELECT id FROM delivery_partners WHERE user_id = $1`, [userId]);
  return dp.rows[0]?.id || null;
}

async function updateDeliveryStatus(req, res, next, { toStatus, timestampColumn, fromStatuses }) {
  try {
    const dpId = await getMyDeliveryId(req.user.id);
    if (!dpId) return res.status(404).json({ error: 'Delivery partner profile not found.' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const deliveryResult = await client.query(
        `SELECT * FROM deliveries WHERE order_id = $1 AND delivery_partner_id = $2 FOR UPDATE`,
        [req.params.orderId, dpId]
      );
      if (deliveryResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Delivery not found for this partner.' });
      }
      const delivery = deliveryResult.rows[0];
      if (!fromStatuses.includes(delivery.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move to ${toStatus} from ${delivery.status}.` });
      }

      const settingsResult = await client.query(`SELECT value FROM platform_settings WHERE key = 'delivery_partner_earning_per_order'`);
      const earningAmount = toStatus === 'delivered'
        ? Number(settingsResult.rows[0]?.value ?? env.business.dpEarningPerOrder)
        : null;

      const updated = await client.query(
        `UPDATE deliveries SET status = $1, ${timestampColumn} = now()${earningAmount !== null ? ', earning_amount = $3' : ''}
         WHERE id = $2 RETURNING *`,
        earningAmount !== null ? [toStatus, delivery.id, earningAmount] : [toStatus, delivery.id]
      );

      // Mirror the high-level status onto the order for customer/shop visibility
      const orderStatusMap = {
        picked_up: 'picked_up',
        out_for_delivery: 'out_for_delivery',
        delivered: 'delivered',
      };
      if (orderStatusMap[toStatus]) {
        await client.query(`UPDATE orders SET status = $1 WHERE id = $2`, [orderStatusMap[toStatus], req.params.orderId]);
      }
      if (toStatus === 'delivered') {
        await client.query(`UPDATE payments SET status = 'collected', collected_by = $1, collected_at = now() WHERE order_id = $2`, [dpId, req.params.orderId]);
      }

      await client.query('COMMIT');
      res.json({ delivery: updated.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

const markReachedPickup = (req, res, next) => updateDeliveryStatus(req, res, next, {
  toStatus: 'reached_pickup', timestampColumn: 'reached_pickup_at', fromStatuses: ['assigned'],
});
const markPickedUp = (req, res, next) => updateDeliveryStatus(req, res, next, {
  toStatus: 'picked_up', timestampColumn: 'picked_up_at', fromStatuses: ['reached_pickup', 'assigned'],
});
const markOutForDelivery = (req, res, next) => updateDeliveryStatus(req, res, next, {
  toStatus: 'out_for_delivery', timestampColumn: 'out_for_delivery_at', fromStatuses: ['picked_up'],
});
const markDelivered = (req, res, next) => updateDeliveryStatus(req, res, next, {
  toStatus: 'delivered', timestampColumn: 'delivered_at', fromStatuses: ['out_for_delivery'],
});

async function getMyDeliveryHistory(req, res, next) {
  try {
    const dpId = await getMyDeliveryId(req.user.id);
    if (!dpId) return res.status(404).json({ error: 'Delivery partner profile not found.' });

    const { rows } = await query(
      `SELECT d.*, o.order_number, o.total_amount, s.name AS shop_name
       FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN shops s ON s.id = o.shop_id
       WHERE d.delivery_partner_id = $1 ORDER BY d.assigned_at DESC`,
      [dpId]
    );
    res.json({ deliveries: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Earnings are the sum of earning_amount on completed deliveries only -
 * never fabricated, always derived from actual delivered records and
 * whatever rate the admin has configured in platform_settings.
 */
async function getMyEarnings(req, res, next) {
  try {
    const dpId = await getMyDeliveryId(req.user.id);
    if (!dpId) return res.status(404).json({ error: 'Delivery partner profile not found.' });

    const { rows } = await query(
      `SELECT COUNT(*)::int AS completed_deliveries, COALESCE(SUM(earning_amount), 0) AS total_earnings
       FROM deliveries WHERE delivery_partner_id = $1 AND status = 'delivered'`,
      [dpId]
    );
    res.json({ earnings: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyProfile, updateMyProfile, uploadDocument,
  goOnline, goOffline, listAvailableDeliveries, acceptDelivery,
  markReachedPickup, markPickedUp, markOutForDelivery, markDelivered,
  getMyDeliveryHistory, getMyEarnings,
};
