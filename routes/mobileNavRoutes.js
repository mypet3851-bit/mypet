import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  listMobileNav,
  listAllMobileNav,
  createMobileNavItem,
  updateMobileNavItem,
  deleteMobileNavItem,
  reorderMobileNav
} from '../controllers/mobileNavController.js';

const router = express.Router();

// Public: active items for the app
router.get('/', listMobileNav);

// Admin: full list and mutations
router.get('/all', adminAuth, listAllMobileNav);
router.post('/', adminAuth, createMobileNavItem);
router.put('/:id', adminAuth, updateMobileNavItem);
router.delete('/:id', adminAuth, deleteMobileNavItem);
router.put('/reorder', adminAuth, reorderMobileNav);

export default router;
