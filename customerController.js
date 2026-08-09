const { query } = require('../config/db');

async function getMyAddresses(req, res, next) {
  try {
    const customer = await query(`SELECT id FROM customers WHERE user_id = $1`, [req.user.id]);
    if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer profile not found.' });

    const { rows } = await query(
      `SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [customer.rows[0].id]
    );
    res.json({ addresses: rows });
  } catch (err) {
    next(err);
  }
}

async function addAddress(req, res, next) {
  try {
    const { label, addressLine, city, state, pincode, latitude, longitude, isDefault } = req.body;
    if (!addressLine) return res.status(400).json({ error: 'addressLine is required.' });

    const customer = await query(`SELECT id FROM customers WHERE user_id = $1`, [req.user.id]);
    if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer profile not found.' });
    const customerId = customer.rows[0].id;

    if (isDefault) {
      await query(`UPDATE addresses SET is_default = FALSE WHERE customer_id = $1`, [customerId]);
    }

    const { rows } = await query(
      `INSERT INTO addresses (customer_id, label, address_line, city, state, pincode, latitude, longitude, is_default)
       VALUES ($1,$2,$3,COALESCE($4,'Srikakulam'),COALESCE($5,'Andhra Pradesh'),$6,$7,$8,COALESCE($9,FALSE))
       RETURNING *`,
      [customerId, label || null, addressLine, city, state, pincode || null, latitude || null, longitude || null, isDefault || false]
    );
    res.status(201).json({ address: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function deleteAddress(req, res, next) {
  try {
    const customer = await query(`SELECT id FROM customers WHERE user_id = $1`, [req.user.id]);
    if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer profile not found.' });

    const result = await query(
      `DELETE FROM addresses WHERE id = $1 AND customer_id = $2 RETURNING id`,
      [req.params.addressId, customer.rows[0].id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Address not found.' });
    res.json({ message: 'Address removed.' });
  } catch (err) {
    next(err);
  }
}

async function getMyOrders(req, res, next) {
  try {
    const customer = await query(`SELECT id FROM customers WHERE user_id = $1`, [req.user.id]);
    if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer profile not found.' });

    const { rows } = await query(
      `SELECT o.*, s.name AS shop_name
       FROM orders o JOIN shops s ON s.id = o.shop_id
       WHERE o.customer_id = $1
       ORDER BY o.placed_at DESC`,
      [customer.rows[0].id]
    );
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyAddresses, addAddress, deleteAddress, getMyOrders };
