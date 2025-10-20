import express from 'express';
import { auth, adminAuth } from '../middleware/auth.js';
import {
  createOrder,
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  recalculateShipping
} from '../controllers/orderController.js';

const router = express.Router();

// Public routes (guest checkout)
router.post('/', (req, res, next) => {
  console.log('POST /orders route hit');
  next();
}, createOrder);

// Protected routes
router.get('/my-orders', auth, getUserOrders);

// Admin routes
router.get('/all', adminAuth, getAllOrders);
// Full admin update (customer info, shipping address, status, fee)
import { updateOrder } from '../controllers/orderController.js';
router.put('/:id', adminAuth, updateOrder);
router.put('/:id/status', adminAuth, updateOrderStatus);
router.post('/:id/recalculate-shipping', adminAuth, recalculateShipping);

export default router;