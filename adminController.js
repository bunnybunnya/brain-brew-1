const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const { generateDeliveryPartnerId } = require('../utils/idGenerator');
const { recordAuditLog } = require('../utils/auditLog');
const env = require('../config/env');

// ---------- CUSTOMERS ----------

async function listCustomers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.mobile, u.email, u.status, u.created_at, c.id AS customer_id
       FROM users u JOIN customers c ON c.user_id = u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ customers: rows });
  } catch (err) {
    next(err);
  }
}

async function setCustomerStatus(req, res, next) {
  try {
    const { status } = req.body; // active | suspended | disabled
    if (!['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const { rows } = await query(
      `UPDATE users SET status = $1 WHERE id = $2 AND role = 'customer' RETURNING id, status`,
      [status, req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });

    await recordAuditLog({
      adminId: req.user.id, action: 'customer.set_status', targetType: 'customer',
      targetId: req.params.userId, details: { status }, ipAddress: req.ip,
    });

    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- SHOPS ----------

async function listShops(req, res, next) {
  try {
    const { status } = req.query;
    const conditions = [];
    const values = [];
    if (status) {
      conditions.push(`s.status = $1`);
      values.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT s.*, u.name AS owner_name, u.mobile AS owner_mobile, u.email AS owner_email
       FROM shops s JOIN shop_owners so ON so.id = s.owner_id JOIN users u ON u.id = so.user_id
       ${where} ORDER BY s.created_at DESC`,
      values
    );
    res.json({ shops: rows });
  } catch (err) {
    next(err);
  }
}

async function setShopStatus(req, res, next) {
  try {
    const { status } = req.body; // pending | approved | rejected | suspended
    if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const { rows } = await query(`UPDATE shops SET status = $1 WHERE id = $2 RETURNING *`, [status, req.params.shopId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Shop not found.' });

    await recordAuditLog({
      adminId: req.user.id, action: `shop.${status}`, targetType: 'shop',
      targetId: req.params.shopId, details: { status }, ipAddress: req.ip,
    });

    res.json({ shop: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- DELIVERY PARTNERS ----------

async function listDeliveryPartners(req, res, next) {
  try {
    const { status } = req.query;
    const conditions = [];
    const values = [];
    if (status) {
      conditions.push(`dp.status = $1`);
      values.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT dp.id, dp.dp_code, dp.status, dp.status_reason, dp.vehicle_type, dp.vehicle_number,
              dp.driving_licence_no, dp.rc_number, dp.is_online, dp.created_at,
              u.id AS user_id, u.name, u.mobile, u.email
       FROM delivery_partners dp JOIN users u ON u.id = dp.user_id
       ${where} ORDER BY dp.created_at DESC`,
      values
    );
    res.json({ deliveryPartners: rows });
  } catch (err) {
    next(err);
  }
}

async function getDeliveryPartnerDetail(req, res, next) {
  try {
    const dpResult = await query(
      `SELECT dp.*, u.name, u.mobile, u.email
       FROM delivery_partners dp JOIN users u ON u.id = dp.user_id
       WHERE dp.id = $1`,
      [req.params.dpId]
    );
    if (dpResult.rows.length === 0) return res.status(404).json({ error: 'Delivery partner not found.' });

    const docsResult = await query(
      `SELECT id, doc_type, verified, uploaded_at FROM delivery_documents WHERE delivery_partner_id = $1`,
      [req.params.dpId]
    );

    await recordAuditLog({
      adminId: req.user.id, action: 'dp.view_documents', targetType: 'delivery_partner',
      targetId: req.params.dpId, ipAddress: req.ip,
    });

    res.json({ deliveryPartner: dpResult.rows[0], documents: docsResult.rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Streams a delivery partner's private document to the admin only.
 * The file is never reachable through a public static route.
 */
async function downloadDocument(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT dd.file_key, dd.doc_type, dd.delivery_partner_id
       FROM delivery_documents dd WHERE dd.id = $1`,
      [req.params.docId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found.' });
    const doc = rows[0];

    if (env.storage.driver !== 'local') {
      return res.status(501).json({ error: 'Configure a signed-URL download for your production object storage driver.' });
    }

    const filePath = path.join(env.storage.localUploadDir, doc.file_key);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage.' });

    await recordAuditLog({
      adminId: req.user.id, action: 'dp.download_document', targetType: 'delivery_partner',
      targetId: doc.delivery_partner_id, details: { docType: doc.doc_type }, ipAddress: req.ip,
    });

    res.download(filePath);
  } catch (err) {
    next(err);
  }
}

async function setDeliveryPartnerStatus(req, res, next) {
  try {
    const { status, reason } = req.body; // approved | rejected | correction_requested | suspended | disabled
    if (!['approved', 'rejected', 'correction_requested', 'suspended', 'disabled', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    let dpCode = null;
    if (status === 'approved') {
      const existing = await query(`SELECT dp_code FROM delivery_partners WHERE id = $1`, [req.params.dpId]);
      dpCode = existing.rows[0]?.dp_code || (await generateDeliveryPartnerId());
    }

    const { rows } = await query(
      `UPDATE delivery_partners SET
         status = $1,
         status_reason = $2,
         dp_code = COALESCE($3, dp_code),
         approved_by = CASE WHEN $1 = 'approved' THEN $4 ELSE approved_by END,
         approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END
       WHERE id = $5 RETURNING *`,
      [status, reason || null, dpCode, req.user.id, req.params.dpId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Delivery partner not found.' });

    await recordAuditLog({
      adminId: req.user.id, action: `dp.${status}`, targetType: 'delivery_partner',
      targetId: req.params.dpId, details: { status, reason }, ipAddress: req.ip,
    });

    res.json({ deliveryPartner: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- ORDERS (oversight) ----------

async function listAllOrders(req, res, next) {
  try {
    const { status } = req.query;
    const conditions = [];
    const values = [];
    if (status) {
      conditions.push(`o.status = $1`);
      values.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id = o.shop_id
       ${where} ORDER BY o.placed_at DESC LIMIT 500`,
      values
    );
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
}

// ---------- PLATFORM SETTINGS ----------

async function getSettings(req, res, next) {
  try {
    const { rows } = await query(`SELECT key, value, updated_at FROM platform_settings`);
    res.json({ settings: rows });
  } catch (err) {
    next(err);
  }
}

async function updateSetting(req, res, next) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required.' });

    const { rows } = await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
       RETURNING *`,
      [key, JSON.stringify(value)]
    );

    await recordAuditLog({
      adminId: req.user.id, action: 'settings.update', targetType: 'platform_settings',
      targetId: null, details: { key, value }, ipAddress: req.ip,
    });

    res.json({ setting: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- AUDIT LOGS ----------

async function listAuditLogs(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT al.*, u.name AS admin_name FROM audit_logs al LEFT JOIN users u ON u.id = al.admin_id
       ORDER BY al.created_at DESC LIMIT 500`
    );
    res.json({ auditLogs: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCustomers, setCustomerStatus,
  listShops, setShopStatus,
  listDeliveryPartners, getDeliveryPartnerDetail, downloadDocument, setDeliveryPartnerStatus,
  listAllOrders,
  getSettings, updateSetting,
  listAuditLogs,
};
