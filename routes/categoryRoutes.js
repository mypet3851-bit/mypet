import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getAllCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories
} from '../controllers/categoryController.js';

const router = express.Router();

// Public routes
router.get('/', getAllCategories);
router.get('/:id', getCategory);

// Admin routes
router.post('/', adminAuth, createCategory);
router.put('/reorder', adminAuth, reorderCategories);
router.put('/:id([0-9a-fA-F]{24})', adminAuth, updateCategory);
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, deleteCategory);

export default router;