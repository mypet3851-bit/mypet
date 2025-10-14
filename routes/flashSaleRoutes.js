import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listAdmin, create, update, remove, publicActiveList } from '../controllers/flashSaleController.js';

const router = express.Router();

// Public
router.get('/public/active/list', publicActiveList);

// Admin
router.get('/', adminAuth, listAdmin);
router.post('/', adminAuth, create);
router.put('/:id', adminAuth, update);
router.delete('/:id', adminAuth, remove);

export default router;
