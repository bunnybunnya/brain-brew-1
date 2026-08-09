const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const orderController = require('../controllers/orderController');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.use(authenticate, requireRole('admin'));

router.get('/me', authController.me);

// Customers
router.get('/customers', adminController.listCustomers);
router.patch('/customers/:userId/status', adminController.setCustomerStatus);

// Shops
router.get('/shops', adminController.listShops);
router.patch('/shops/:shopId/status', adminController.setShopStatus);

// Delivery partners
router.get('/delivery-partners', adminController.listDeliveryPartners);
router.get('/delivery-partners/:dpId', adminController.getDeliveryPartnerDetail);
router.get('/delivery-partners/documents/:docId/download', adminController.downloadDocument);
router.patch('/delivery-partners/:dpId/status', adminController.setDeliveryPartnerStatus);

// Orders (oversight)
router.get('/orders', adminController.listAllOrders);
router.get('/orders/:orderId', orderController.getOrderDetail); // admin passes isAuthorizedForOrder check

// Platform settings
router.get('/settings', adminController.getSettings);
router.put('/settings/:key', adminController.updateSetting);

// Audit log
router.get('/audit-logs', adminController.listAuditLogs);

module.exports = router;
