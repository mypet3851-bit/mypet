import MobileNavItem from '../models/MobileNavItem.js';

// Public: list active items ordered
export const listMobileNav = async (req, res) => {
  try {
    const items = await MobileNavItem.find({ isActive: true }).sort({ order: 1, _id: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: list all (including inactive)
export const listAllMobileNav = async (req, res) => {
  try {
    const items = await MobileNavItem.find().sort({ order: 1, _id: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: create item
export const createMobileNavItem = async (req, res) => {
  try {
    const item = new MobileNavItem(req.body);
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Admin: update item
export const updateMobileNavItem = async (req, res) => {
  try {
    const item = await MobileNavItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Mobile nav item not found' });
    res.json(item);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Admin: delete item
export const deleteMobileNavItem = async (req, res) => {
  try {
    const item = await MobileNavItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Mobile nav item not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: reorder items (accepts array of { id, order })
export const reorderMobileNav = async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ message: 'items array required' });
    await Promise.all(items.map(({ id, order }) => MobileNavItem.findByIdAndUpdate(id, { order })));
    res.json({ message: 'Reordered' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
