import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import NavigationCategory from '../models/NavigationCategory.js';
import Category from '../models/Category.js';

const router = express.Router();

function sanitizeSlug(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function ensureUniqueSlug(desired, excludeId) {
  let base = sanitizeSlug(desired) || 'nav';
  let candidate = base;
  let counter = 1;
  // Loop until a free slug is found
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await NavigationCategory.findOne({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('_id');
    if (!exists) return candidate;
    candidate = `${base}-${counter++}`;
  }
}

// Get all navigation categories
router.get('/', async (req, res) => {
  try {
    const categories = await NavigationCategory.find()
      .populate('categories', '_id name slug path')
      .sort('order');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create navigation category (admin only)
router.post('/', adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    // Normalize/ensure unique slug if client provided one
    if (body.slug) {
      body.slug = await ensureUniqueSlug(body.slug);
    }
    // If client sent subCategories with slugs but not categories, map them here too
    if ((!body.categories || body.categories.length === 0) && Array.isArray(body.subCategories)) {
      const slugs = body.subCategories.map((s) => s && s.slug).filter(Boolean);
      if (slugs.length > 0) {
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        body.categories = docs.map(d => d._id);
      }
    }
    const category = new NavigationCategory(body);
    const savedCategory = await category.save();
    const populated = await savedCategory.populate('categories', '_id name slug path');
    res.status(201).json(populated);
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
    const body = req.body || {};
    // Normalize/ensure unique slug if provided
    if (body.slug) {
      body.slug = await ensureUniqueSlug(body.slug, req.params.id);
    }
    // Map subCategories slugs to categories if categories not explicitly provided
    if ((!body.categories || body.categories.length === 0) && Array.isArray(body.subCategories)) {
      const slugs = body.subCategories.map((s) => s && s.slug).filter(Boolean);
      if (slugs.length > 0) {
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        body.categories = docs.map(d => d._id);
      } else {
        body.categories = [];
      }
    }
    const category = await NavigationCategory.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true, runValidators: true }
    ).populate('categories', '_id name slug path');
    
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

// Public: get a single navigation category by slug with its mapped categories
router.get('/:slug', async (req, res) => {
  try {
    const doc = await NavigationCategory.findOne({ slug: req.params.slug, isActive: true })
      .populate('categories', '_id name slug path');
    if (!doc) return res.status(404).json({ message: 'Navigation item not found' });
    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reorder route moved above and consolidated

export default router;
