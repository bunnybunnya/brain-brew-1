const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.use(authenticate, requireRole('customer'));

router.get('/addresses', customerController.getMyAddresses);
router.post('/addresses', customerController.addAddress);
router.delete('/addresses/:addressId', customerController.deleteAddress);

router.get('/orders', customerController.getMyOrders);

module.exports = router;
