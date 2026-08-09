const { query } = require('../config/db');

// ---------- SHOP OWNER: manage own shop ----------

async function getMyShop(req, res, next) {
  try {
    const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [req.user.id]);
    if (owner.rows.length === 0) return res.status(404).json({ error: 'Shop owner profile not found.' });

    const { rows } = await query(`SELECT * FROM shops WHERE owner_id = $1`, [owner.rows[0].id]);
    res.json({ shop: rows[0] || null });
  } catch (err) {
    next(err);
  }
}

async function createShop(req, res, next) {
  try {
    const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [req.user.id]);
    if (owner.rows.length === 0) return res.status(404).json({ error: 'Shop owner profile not found.' });
    const ownerId = owner.rows[0].id;

    const existing = await query(`SELECT id FROM shops WHERE owner_id = $1`, [ownerId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a shop. Use update instead.' });
    }

    const { name, description, phone, addressLine, city, state, pincode, latitude, longitude, logoUrl } = req.body;
    if (!name || !phone || !addressLine) {
      return res.status(400).json({ error: 'name, phone and addressLine are required.' });
    }

    // status defaults to 'pending' - admin must approve before it's visible to customers
    const { rows } = await query(
      `INSERT INTO shops (owner_id, name, description, phone, address_line, city, state, pincode, latitude, longitude, logo_url)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'Srikakulam'),COALESCE($7,'Andhra Pradesh'),$8,$9,$10,$11)
       RETURNING *`,
      [ownerId, name, description || null, phone, addressLine, city, state, pincode || null, latitude || null, longitude || null, logoUrl || null]
    );
    res.status(201).json({ shop: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateMyShop(req, res, next) {
  try {
    const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [req.user.id]);
    if (owner.rows.length === 0) return res.status(404).json({ error: 'Shop owner profile not found.' });

    const fields = ['name', 'description', 'phone', 'address_line', 'city', 'state', 'pincode', 'latitude', 'longitude', 'logo_url'];
    const bodyMap = {
      name: req.body.name, description: req.body.description, phone: req.body.phone,
      address_line: req.body.addressLine, city: req.body.city, state: req.body.state,
      pincode: req.body.pincode, latitude: req.body.latitude, longitude: req.body.longitude,
      logo_url: req.body.logoUrl,
    };

    const setClauses = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (bodyMap[f] !== undefined) {
        setClauses.push(`${f} = $${i}`);
        values.push(bodyMap[f]);
        i += 1;
      }
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update.' });

    values.push(owner.rows[0].id);
    const { rows } = await query(
      `UPDATE shops SET ${setClauses.join(', ')} WHERE owner_id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ shop: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function setShopOpenStatus(req, res, next) {
  try {
    const { isOpen } = req.body;
    if (typeof isOpen !== 'boolean') return res.status(400).json({ error: 'isOpen (boolean) is required.' });

    const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [req.user.id]);
    if (owner.rows.length === 0) return res.status(404).json({ error: 'Shop owner profile not found.' });

    const { rows } = await query(
      `UPDATE shops SET is_open = $1 WHERE owner_id = $2 RETURNING *`,
      [isOpen, owner.rows[0].id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ shop: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- CUSTOMER-FACING (public / authenticated customer) ----------

async function listApprovedShops(req, res, next) {
  try {
    const { city, search } = req.query;
    const conditions = [`status = 'approved'`];
    const values = [];
    let i = 1;

    if (city) {
      conditions.push(`city ILIKE $${i}`);
      values.push(city);
      i += 1;
    }
    if (search) {
      conditions.push(`name ILIKE $${i}`);
      values.push(`%${search}%`);
      i += 1;
    }

    const { rows } = await query(
      `SELECT id, name, description, logo_url, address_line, city, is_open, created_at
       FROM shops WHERE ${conditions.join(' AND ')}
       ORDER BY is_open DESC, name ASC`,
      values
    );
    res.json({ shops: rows });
  } catch (err) {
    next(err);
  }
}

async function getShopDetail(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, name, description, logo_url, phone, address_line, city, state, pincode, is_open, status
       FROM shops WHERE id = $1 AND status = 'approved'`,
      [req.params.shopId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ shop: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyShop, createShop, updateMyShop, setShopOpenStatus,
  listApprovedShops, getShopDetail,
};
