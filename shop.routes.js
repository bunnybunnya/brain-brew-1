const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const orderController = require('../controllers/orderController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// ---- Public / customer-facing browsing (no shop-owner auth needed) ----
router.get('/public', shopController.listApprovedShops);
router.get('/public/:shopId', shopController.getShopDetail);

// ---- Shop owner: manage own shop ----
router.use('/me', authenticate, requireRole('shop_owner'));
router.get('/me', shopController.getMyShop);
router.post('/me', shopController.createShop);
router.patch('/me', shopController.updateMyShop);
router.patch('/me/open-status', shopController.setShopOpenStatus);

router.get('/me/orders', authenticate, requireRole('shop_owner'), orderController.listShopOrders);
router.post('/me/orders/:orderId/accept', authenticate, requireRole('shop_owner'), orderController.acceptOrder);
router.post('/me/orders/:orderId/reject', authenticate, requireRole('shop_owner'), orderController.rejectOrder);
router.post('/me/orders/:orderId/preparing', authenticate, requireRole('shop_owner'), orderController.markPreparing);
router.post('/me/orders/:orderId/ready', authenticate, requireRole('shop_owner'), orderController.markReadyForPickup);

module.exports = router;
