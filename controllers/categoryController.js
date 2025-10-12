import Category from '../models/Category.js';

// Get all categories
export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort('order');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single category
export const getCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create category
export const createCategory = async (req, res) => {
  try {
    // Validate name
    if (!req.body.name || req.body.name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    // Check for duplicate name
    const existingCategory = await Category.findOne({ 
      name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') }
    });
    
    if (existingCategory) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    const category = new Category({
      ...req.body,
      name: req.body.name.trim() // Ensure name is trimmed
    });
    
    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      if (error.keyPattern.slug) {
        res.status(400).json({ message: 'Category with this slug already exists' });
      } else if (error.keyPattern.name) {
        res.status(400).json({ message: 'Category with this name already exists' });
      } else {
        res.status(400).json({ message: 'Duplicate key error' });
      }
    } else {
      res.status(400).json({ message: error.message });
    }
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    // Validate name if provided
    if (req.body.name && req.body.name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name cannot be empty' });
    }

    // Check for duplicate name if name is being changed
    if (req.body.name) {
      const existingCategory = await Category.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') }
      });

      if (existingCategory) {
        return res.status(400).json({ message: 'Category with this name already exists' });
      }
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { ...req.body, name: req.body.name?.trim() },
      { new: true, runValidators: true }
    );
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      if (error.keyPattern.slug) {
        res.status(400).json({ message: 'Category with this slug already exists' });
      } else if (error.keyPattern.name) {
        res.status(400).json({ message: 'Category with this name already exists' });
      } else {
        res.status(400).json({ message: 'Duplicate key error' });
      }
    } else {
      res.status(400).json({ message: error.message });
    }
  }
};

// Delete category
export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reorder categories
export const reorderCategories = async (req, res) => {
  try {
    const { categories } = req.body;
    await Promise.all(
      categories.map(({ id, order }) => 
        Category.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};