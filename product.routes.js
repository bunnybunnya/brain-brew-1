const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// ---- Customer-facing ----
router.get('/public/shop/:shopId', productController.listShopProducts);

// ---- Shop owner ----
router.use(authenticate, requireRole('shop_owner'));
router.get('/me', productController.listMyProducts);
router.post('/me', productController.createProduct);
router.patch('/me/:productId', productController.updateProduct);
router.delete('/me/:productId', productController.deleteProduct);

router.post('/me/:productId/variants', productController.addVariant);
router.patch('/me/variants/:variantId', productController.updateVariant);
router.delete('/me/variants/:variantId', productController.deleteVariant);

module.exports = router;
