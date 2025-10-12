import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import NavigationCategory from '../models/NavigationCategory.js';

const router = express.Router();

// Get all navigation categories
router.get('/', async (req, res) => {
  try {
    const categories = await NavigationCategory.find().sort('order');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create navigation category (admin only)
router.post('/', adminAuth, async (req, res) => {
  try {
    const category = new NavigationCategory(req.body);
    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Category with this name or slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Update navigation category (admin only)
router.put('/reorder', adminAuth, async (req, res) => {
  try {
    const { categories } = req.body;
    await Promise.all(
      categories.map(({ id, order }) => 
        NavigationCategory.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update navigation category (admin only)
router.put('/:id([0-9a-fA-F]{24})', adminAuth, async (req, res) => {
  try {
    const category = await NavigationCategory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Category with this name or slug already exists' });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Delete navigation category (admin only)
router.delete('/:id([0-9a-fA-F]{24})', adminAuth, async (req, res) => {
  try {
    const category = await NavigationCategory.findByIdAndDelete(req.params.id);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reorder route moved above and consolidated

export default router;