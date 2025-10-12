import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  createCoupon,
  getAllCoupons,
  getCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  applyCoupon
} from '../controllers/couponController.js';

const router = express.Router();

// Admin routes
router.post('/', adminAuth, createCoupon);
router.get('/', adminAuth, getAllCoupons);
router.get('/:id', adminAuth, getCoupon);
router.put('/:id', adminAuth, updateCoupon);
router.delete('/:id', adminAuth, deleteCoupon);

// Public routes
router.post('/validate', validateCoupon);
router.post('/:code/apply', applyCoupon);

export default router;