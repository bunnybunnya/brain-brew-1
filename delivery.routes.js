const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { requireApprovedDeliveryPartner } = require('../middleware/deliveryGuard');
const { upload } = require('../middleware/upload');

router.use(authenticate, requireRole('delivery_partner'));

// Profile & document upload - available even before approval, so the
// partner can complete registration and see their status.
router.get('/me', deliveryController.getMyProfile);
router.patch('/me', deliveryController.updateMyProfile);
router.post('/me/documents', upload.single('document'), deliveryController.uploadDocument);

// Dashboard - approved partners only
router.post('/me/online', requireApprovedDeliveryPartner(), deliveryController.goOnline);
router.post('/me/offline', requireApprovedDeliveryPartner(), deliveryController.goOffline);

router.get('/available-deliveries', requireApprovedDeliveryPartner({ mustBeOnline: true }), deliveryController.listAvailableDeliveries);
router.post('/orders/:orderId/accept', requireApprovedDeliveryPartner({ mustBeOnline: true }), deliveryController.acceptDelivery);
router.post('/orders/:orderId/reached-pickup', requireApprovedDeliveryPartner(), deliveryController.markReachedPickup);
router.post('/orders/:orderId/picked-up', requireApprovedDeliveryPartner(), deliveryController.markPickedUp);
router.post('/orders/:orderId/out-for-delivery', requireApprovedDeliveryPartner(), deliveryController.markOutForDelivery);
router.post('/orders/:orderId/delivered', requireApprovedDeliveryPartner(), deliveryController.markDelivered);

router.get('/me/history', deliveryController.getMyDeliveryHistory);
router.get('/me/earnings', deliveryController.getMyEarnings);

module.exports = router;
