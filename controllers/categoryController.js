import Category from '../models/Category.js';
import Product from '../models/Product.js';

// Get all categories
export const getAllCategories = async (req, res) => {
  try {
    // Optional: asTree=true to return nested structure, otherwise flat list
    const asTree = String(req.query.asTree || '').toLowerCase() === 'true';
    const categories = await Category.find().sort({ depth: 1, order: 1, name: 1 }).lean();
    if (!asTree) return res.json(categories);

    // Build tree
    const byId = new Map(categories.map(c => [String(c._id), { ...c, children: [] }]));
    const roots = [];
    for (const cat of byId.values()) {
      if (cat.parent) {
        const p = byId.get(String(cat.parent));
        if (p) p.children.push(cat); else roots.push(cat);
      } else {
        roots.push(cat);
      }
    }
    // Sort children by order then name for stable UI
    const sortRec = (nodes) => {
      nodes.sort((a,b)=> (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
      nodes.forEach(n=> sortRec(n.children||[]));
    };
    sortRec(roots);
    res.json(roots);
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

    // Check for duplicate name under same parent
    const existingCategory = await Category.findOne({ 
      name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
      parent: req.body.parent || null
    });
    
    if (existingCategory) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    const payload = {
      ...req.body,
      name: req.body.name.trim()
    };
    // Validate parent if provided
    if (payload.parent) {
      const parent = await Category.findById(payload.parent).select('_id');
      if (!parent) return res.status(400).json({ message: 'Parent category not found' });
    }

    const category = new Category(payload);
    
    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      if (error.keyPattern.slug) {
        res.status(400).json({ message: 'Category with this slug already exists' });
      } else if (error.keyPattern.name) {
  res.status(400).json({ message: 'Category with this name already exists under the same parent' });
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

    // Check for duplicate name (scoped by parent) if name is being changed
    if (req.body.name) {
      const existingCategory = await Category.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
        parent: req.body.parent ?? (await Category.findById(req.params.id))?.parent ?? null
      });

      if (existingCategory) {
        return res.status(400).json({ message: 'Category with this name already exists' });
      }
    }

    // Validate parent if supplied
    const updatePayload = { ...req.body, name: req.body.name?.trim() };
    if (updatePayload.parent !== undefined) {
      if (!updatePayload.parent) {
        updatePayload.parent = null; // allow making a root category
      } else {
        if (String(updatePayload.parent) === req.params.id) {
          return res.status(400).json({ message: 'Category cannot be its own parent' });
        }
        const parent = await Category.findById(updatePayload.parent);
        if (!parent) return res.status(400).json({ message: 'Parent category not found' });
        // Cycle check: parent cannot be a descendant
        const parentAncestors = (parent.ancestors || []).map(String);
        if (parentAncestors.includes(req.params.id)) {
          return res.status(400).json({ message: 'Invalid parent: would create a cycle' });
        }
      }
    }

    // Fetch doc first to recompute path/ancestors via save hook
    let category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    Object.assign(category, updatePayload);
    category = await category.save();

    // If slug or parent changed, update descendants' paths/ancestors
    const children = await Category.find({ ancestors: category._id }).lean();
    if (children.length) {
      const all = await Category.find({ _id: { $in: children.map(c=>c._id) } });
      // Re-save each to trigger pre-save recomputation using its current parent
      await Promise.all(all.map(async c => { c.markModified('slug'); return c.save(); }));
    }
    
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
  res.status(400).json({ message: 'Category with this name already exists under the same parent' });
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
    const id = req.params.id;
    const hasChildren = await Category.exists({ parent: id });
    if (hasChildren) {
      return res.status(400).json({ message: 'Cannot delete a category that has subcategories' });
    }
    const inProducts = await Product.exists({ $or: [ { category: id }, { categories: id } ] });
    if (inProducts) {
      return res.status(400).json({ message: 'Cannot delete a category in use by products' });
    }
    const category = await Category.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
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

// Get subcategories of a parent id (or root when parent is null)
export const getSubcategories = async (req, res) => {
  try {
    const parentId = req.params.parentId === 'root' ? null : req.params.parentId;
    const filter = parentId ? { parent: parentId } : { parent: null };
    const list = await Category.find(filter).sort({ order: 1, name: 1 });
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get the full category tree starting from root
export const getCategoryTree = async (req, res) => {
  try {
    const categories = await Category.find().sort({ depth: 1, order: 1, name: 1 }).lean();
    const byId = new Map(categories.map(c => [String(c._id), { ...c, children: [] }]));
    const roots = [];
    for (const cat of byId.values()) {
      if (cat.parent) {
        const p = byId.get(String(cat.parent));
        if (p) p.children.push(cat); else roots.push(cat);
      } else {
        roots.push(cat);
      }
    }
    const sortRec = (nodes) => {
      nodes.sort((a,b)=> (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
      nodes.forEach(n=> sortRec(n.children||[]));
    };
    sortRec(roots);
    res.json(roots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
