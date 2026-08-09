const { query, getClient } = require('../config/db');
const env = require('../config/env');
const { generateOrderNumber } = require('../utils/idGenerator');
const { sendOrderInvoiceWhatsApp } = require('../utils/whatsapp');

// ---------- CUSTOMER: checkout ----------

/**
 * Places an order. All prices come from product_variants at the moment
 * of ordering (never trusted from the client) and are snapshotted onto
 * order_items so a later price change doesn't alter historical orders.
 * Payment method is fixed to COD (the only method this platform supports).
 */
async function createOrder(req, res, next) {
  const client = await getClient();
  try {
    const { shopId, addressId, items } = req.body;
    // items: [{ productId, variantId, quantity }]

    if (!shopId || !addressId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'shopId, addressId and at least one item are required.' });
    }

    const customerResult = await query(`SELECT id FROM customers WHERE user_id = $1`, [req.user.id]);
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer profile not found.' });
    const customerId = customerResult.rows[0].id;

    const addressCheck = await query(`SELECT id FROM addresses WHERE id = $1 AND customer_id = $2`, [addressId, customerId]);
    if (addressCheck.rows.length === 0) return res.status(400).json({ error: 'Invalid delivery address.' });

    const shopResult = await query(`SELECT * FROM shops WHERE id = $1 AND status = 'approved'`, [shopId]);
    if (shopResult.rows.length === 0) return res.status(404).json({ error: 'Shop not found or not approved.' });
    const shop = shopResult.rows[0];
    if (!shop.is_open) return res.status(400).json({ error: 'This shop is currently closed.' });

    await client.query('BEGIN');

    let subtotal = 0;
    const orderItemsData = [];

    for (const item of items) {
      if (!item.variantId || !item.quantity || Number(item.quantity) <= 0) {
        throw Object.assign(new Error('Each item needs variantId and a positive quantity.'), { statusCode: 400 });
      }

      const variantResult = await client.query(
        `SELECT v.*, p.name AS product_name, p.shop_id
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = $1 FOR UPDATE`,
        [item.variantId]
      );
      if (variantResult.rows.length === 0) {
        throw Object.assign(new Error(`Product variant not found: ${item.variantId}`), { statusCode: 400 });
      }
      const variant = variantResult.rows[0];

      if (variant.shop_id !== shopId) {
        throw Object.assign(new Error('All items in an order must be from the same shop.'), { statusCode: 400 });
      }
      if (!variant.is_available) {
        throw Object.assign(new Error(`${variant.product_name} (${variant.cut_type}) is currently unavailable.`), { statusCode: 400 });
      }
      if (Number(variant.quantity_available) < Number(item.quantity)) {
        throw Object.assign(new Error(`Not enough stock for ${variant.product_name} (${variant.cut_type}).`), { statusCode: 400 });
      }

      const lineTotal = Number(variant.price) * Number(item.quantity);
      subtotal += lineTotal;

      orderItemsData.push({
        productId: variant.product_id,
        variantId: variant.id,
        productName: variant.product_name,
        cutType: variant.cut_type,
        unitPrice: variant.price,
        quantity: item.quantity,
        lineTotal,
      });

      // Decrement stock
      await client.query(
        `UPDATE product_variants SET quantity_available = quantity_available - $1 WHERE id = $2`,
        [item.quantity, variant.id]
      );
    }

    // Delivery charge / tax come from platform_settings (admin-configured),
    // falling back to the .env defaults if not yet set by the admin.
    const settingsResult = await client.query(
      `SELECT key, value FROM platform_settings WHERE key IN ('delivery_charge_flat', 'tax_percent')`
    );
    const settingsMap = Object.fromEntries(settingsResult.rows.map((r) => [r.key, r.value]));
    const deliveryCharge = Number(settingsMap.delivery_charge_flat ?? env.business.deliveryBaseCharge);
    const taxPercent = Number(settingsMap.tax_percent ?? env.business.taxPercent);
    const taxAmount = Math.round(((subtotal * taxPercent) / 100) * 100) / 100;
    const totalAmount = subtotal + deliveryCharge + taxAmount;

    const orderNumber = await generateOrderNumber();

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, customer_id, shop_id, delivery_address_id, subtotal, delivery_charge, tax_amount, total_amount, payment_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cod','pending')
       RETURNING *`,
      [orderNumber, customerId, shopId, addressId, subtotal, deliveryCharge, taxAmount, totalAmount]
    );
    const order = orderResult.rows[0];

    for (const oi of orderItemsData) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, cut_type, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, oi.productId, oi.variantId, oi.productName, oi.cutType, oi.unitPrice, oi.quantity, oi.lineTotal]
      );
    }

    await client.query(
      `INSERT INTO payments (order_id, method, amount, status) VALUES ($1,'cod',$2,'pending')`,
      [order.id, totalAmount]
    );

    await client.query('COMMIT');

    // Fire-and-log WhatsApp invoice (never blocks the order response on failure)
    const userRow = await query(`SELECT mobile, u.id AS user_id FROM customers c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, [customerId]);
    sendOrderInvoiceWhatsApp({
      order: {
        ...order,
        shop_name: shop.name,
        items: orderItemsData,
        customer_user_id: userRow.rows[0]?.user_id,
      },
      customerMobile: userRow.rows[0]?.mobile,
    }).catch(() => {});

    res.status(201).json({ order: { ...order, items: orderItemsData } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function getOrderDetail(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT o.*, s.name AS shop_name, s.phone AS shop_phone, a.address_line, a.city
       FROM orders o
       JOIN shops s ON s.id = o.shop_id
       JOIN addresses a ON a.id = o.delivery_address_id
       WHERE o.id = $1`,
      [req.params.orderId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = rows[0];

    // Scope check: only the owning customer, the shop owner, the assigned
    // delivery partner, or an admin may view this order.
    const allowed = await isAuthorizedForOrder(req.user, order);
    if (!allowed) return res.status(403).json({ error: 'Not authorized to view this order.' });

    const items = await query(`SELECT * FROM order_items WHERE order_id = $1`, [order.id]);
    res.json({ order: { ...order, items: items.rows } });
  } catch (err) {
    next(err);
  }
}

async function isAuthorizedForOrder(user, order) {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') {
    const c = await query(`SELECT id FROM customers WHERE user_id = $1`, [user.id]);
    return c.rows[0]?.id === order.customer_id;
  }
  if (user.role === 'shop_owner') {
    const s = await query(`SELECT id FROM shops WHERE id = $1 AND owner_id = (SELECT id FROM shop_owners WHERE user_id = $2)`, [order.shop_id, user.id]);
    return s.rows.length > 0;
  }
  if (user.role === 'delivery_partner') {
    const dp = await query(`SELECT id FROM delivery_partners WHERE user_id = $1`, [user.id]);
    return dp.rows[0]?.id === order.delivery_partner_id;
  }
  return false;
}

// ---------- SHOP OWNER: manage incoming orders ----------

async function getMyShopId(userId) {
  const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [userId]);
  if (owner.rows.length === 0) return null;
  const shop = await query(`SELECT id FROM shops WHERE owner_id = $1`, [owner.rows[0].id]);
  return shop.rows[0]?.id || null;
}

async function listShopOrders(req, res, next) {
  try {
    const shopId = await getMyShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found.' });

    const { status } = req.query;
    const conditions = [`o.shop_id = $1`];
    const values = [shopId];
    if (status) {
      conditions.push(`o.status = $2`);
      values.push(status);
    }

    const { rows } = await query(
      `SELECT o.*, a.address_line, a.city FROM orders o JOIN addresses a ON a.id = o.delivery_address_id
       WHERE ${conditions.join(' AND ')} ORDER BY o.placed_at DESC`,
      values
    );
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
}

async function acceptOrder(req, res, next) {
  try {
    const shopId = await getMyShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found.' });
    const { rows } = await query(
      `UPDATE orders SET status = 'accepted' WHERE id = $1 AND shop_id = $2 AND status = 'placed' RETURNING *`,
      [req.params.orderId, shopId]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Order cannot be accepted (not found or wrong status).' });
    res.json({ order: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function rejectOrder(req, res, next) {
  try {
    const shopId = await getMyShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found.' });
    const { reason } = req.body;

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `UPDATE orders SET status = 'rejected', rejection_reason = $1
         WHERE id = $2 AND shop_id = $3 AND status = 'placed' RETURNING *`,
        [reason || 'Rejected by shop', req.params.orderId, shopId]
      );
      if (orderResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Order cannot be rejected (not found or wrong status).' });
      }
      // Restock items
      const items = await client.query(`SELECT variant_id, quantity FROM order_items WHERE order_id = $1`, [req.params.orderId]);
      for (const it of items.rows) {
        await client.query(`UPDATE product_variants SET quantity_available = quantity_available + $1 WHERE id = $2`, [it.quantity, it.variant_id]);
      }
      await client.query('COMMIT');
      res.json({ order: orderResult.rows[0] });
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

async function markPreparing(req, res, next) {
  try {
    const shopId = await getMyShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found.' });
    const { rows } = await query(
      `UPDATE orders SET status = 'preparing' WHERE id = $1 AND shop_id = $2 AND status = 'accepted' RETURNING *`,
      [req.params.orderId, shopId]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Order cannot move to preparing.' });
    res.json({ order: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function markReadyForPickup(req, res, next) {
  try {
    const shopId = await getMyShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found.' });
    // This makes the order visible to eligible (approved, online, active) delivery partners.
    const { rows } = await query(
      `UPDATE orders SET status = 'ready_for_pickup' WHERE id = $1 AND shop_id = $2 AND status = 'preparing' RETURNING *`,
      [req.params.orderId, shopId]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Order cannot move to ready_for_pickup.' });
    res.json({ order: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder, getOrderDetail, listShopOrders,
  acceptOrder, rejectOrder, markPreparing, markReadyForPickup,
};
