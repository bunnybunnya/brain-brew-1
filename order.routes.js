const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.post('/', authenticate, requireRole('customer'), orderController.createOrder);
router.get('/:orderId', authenticate, orderController.getOrderDetail); // authorization scoped inside controller

module.exports = router;
