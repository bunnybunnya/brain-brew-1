const { query } = require('../config/db');

async function getOwnedShopId(userId) {
  const owner = await query(`SELECT id FROM shop_owners WHERE user_id = $1`, [userId]);
  if (owner.rows.length === 0) return null;
  const shop = await query(`SELECT id FROM shops WHERE owner_id = $1`, [owner.rows[0].id]);
  return shop.rows[0]?.id || null;
}

// ---------- SHOP OWNER: manage own products ----------

async function listMyProducts(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { rows } = await query(
      `SELECT p.*, COALESCE(json_agg(v.* ORDER BY v.created_at) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
       FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
       WHERE p.shop_id = $1 GROUP BY p.id ORDER BY p.created_at DESC`,
      [shopId]
    );
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
}

async function createProduct(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { name, description, imageUrl, variants } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ error: 'At least one variant (cut/type with price) is required.' });
    }
    for (const v of variants) {
      if (!v.cutType || v.price === undefined || v.price === null) {
        return res.status(400).json({ error: 'Each variant needs cutType and price.' });
      }
      if (Number(v.price) < 0) return res.status(400).json({ error: 'Price cannot be negative.' });
    }

    const productResult = await query(
      `INSERT INTO products (shop_id, name, description, image_url) VALUES ($1,$2,$3,$4) RETURNING *`,
      [shopId, name, description || null, imageUrl || null]
    );
    const product = productResult.rows[0];

    const insertedVariants = [];
    for (const v of variants) {
      const { rows } = await query(
        `INSERT INTO product_variants (product_id, cut_type, unit, price, quantity_available, is_available)
         VALUES ($1,$2,COALESCE($3,'kg'),$4,COALESCE($5,0),COALESCE($6,TRUE)) RETURNING *`,
        [product.id, v.cutType, v.unit, v.price, v.quantityAvailable, v.isAvailable]
      );
      insertedVariants.push(rows[0]);
    }

    res.status(201).json({ product: { ...product, variants: insertedVariants } });
  } catch (err) {
    next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { name, description, imageUrl, isAvailable } = req.body;
    const { rows } = await query(
      `UPDATE products SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         image_url = COALESCE($3, image_url),
         is_available = COALESCE($4, is_available)
       WHERE id = $5 AND shop_id = $6 RETURNING *`,
      [name, description, imageUrl, isAvailable, req.params.productId, shopId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { rows } = await query(
      `DELETE FROM products WHERE id = $1 AND shop_id = $2 RETURNING id`,
      [req.params.productId, shopId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ message: 'Product removed.' });
  } catch (err) {
    next(err);
  }
}

async function addVariant(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const productCheck = await query(`SELECT id FROM products WHERE id = $1 AND shop_id = $2`, [req.params.productId, shopId]);
    if (productCheck.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });

    const { cutType, unit, price, quantityAvailable, isAvailable } = req.body;
    if (!cutType || price === undefined) return res.status(400).json({ error: 'cutType and price are required.' });
    if (Number(price) < 0) return res.status(400).json({ error: 'Price cannot be negative.' });

    const { rows } = await query(
      `INSERT INTO product_variants (product_id, cut_type, unit, price, quantity_available, is_available)
       VALUES ($1,$2,COALESCE($3,'kg'),$4,COALESCE($5,0),COALESCE($6,TRUE)) RETURNING *`,
      [req.params.productId, cutType, unit, price, quantityAvailable, isAvailable]
    );
    res.status(201).json({ variant: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateVariant(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { price, quantityAvailable, isAvailable, cutType, unit } = req.body;
    if (price !== undefined && Number(price) < 0) return res.status(400).json({ error: 'Price cannot be negative.' });

    const { rows } = await query(
      `UPDATE product_variants v SET
         price = COALESCE($1, v.price),
         quantity_available = COALESCE($2, v.quantity_available),
         is_available = COALESCE($3, v.is_available),
         cut_type = COALESCE($4, v.cut_type),
         unit = COALESCE($5, v.unit)
       FROM products p
       WHERE v.id = $6 AND v.product_id = p.id AND p.shop_id = $7
       RETURNING v.*`,
      [price, quantityAvailable, isAvailable, cutType, unit, req.params.variantId, shopId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Variant not found.' });
    res.json({ variant: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function deleteVariant(req, res, next) {
  try {
    const shopId = await getOwnedShopId(req.user.id);
    if (!shopId) return res.status(404).json({ error: 'Shop not found for this owner.' });

    const { rows } = await query(
      `DELETE FROM product_variants v USING products p
       WHERE v.id = $1 AND v.product_id = p.id AND p.shop_id = $2
       RETURNING v.id`,
      [req.params.variantId, shopId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Variant not found.' });
    res.json({ message: 'Variant removed.' });
  } catch (err) {
    next(err);
  }
}

// ---------- CUSTOMER-FACING ----------

async function listShopProducts(req, res, next) {
  try {
    const shopCheck = await query(`SELECT id FROM shops WHERE id = $1 AND status = 'approved'`, [req.params.shopId]);
    if (shopCheck.rows.length === 0) return res.status(404).json({ error: 'Shop not found.' });

    const { rows } = await query(
      `SELECT p.id, p.name, p.description, p.image_url, p.is_available,
              COALESCE(json_agg(v.* ORDER BY v.price) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
       FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
       WHERE p.shop_id = $1 AND p.is_available = TRUE
       GROUP BY p.id ORDER BY p.name`,
      [req.params.shopId]
    );
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMyProducts, createProduct, updateProduct, deleteProduct,
  addVariant, updateVariant, deleteVariant, listShopProducts,
};
