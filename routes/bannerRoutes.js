import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getBanners,
  getActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners
} from '../controllers/bannerController.js';

const router = express.Router();

// Public
router.get('/active', getActiveBanners);

// Admin
router.get('/', adminAuth, getBanners);
router.post('/', adminAuth, createBanner);
router.put('/reorder', adminAuth, reorderBanners);
router.put('/:id([0-9a-fA-F]{24})', adminAuth, updateBanner);
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, deleteBanner);

export default router;
