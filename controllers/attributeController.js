import Attribute from '../models/Attribute.js';
import AttributeValue from '../models/AttributeValue.js';

export const listAttributes = async (req, res) => {
  try {
    const items = await Attribute.find().sort({ order: 1, name: 1 });
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load attributes' });
  }
};

export const getAttribute = async (req, res) => {
  try {
    const item = await Attribute.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    res.json(item);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load attribute' });
  }
};

export const createAttribute = async (req, res) => {
  try {
    const { name, type, description, allowMultiple, required, order, slug } = req.body;
    const exists = await Attribute.findOne({ name: new RegExp(`^${String(name).trim()}$`, 'i') });
    if (exists) return res.status(400).json({ message: 'Attribute with this name already exists' });
    const attr = new Attribute({ name, type, description, allowMultiple, required, order, slug });
    const saved = await attr.save();
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create attribute' });
  }
};

export const updateAttribute = async (req, res) => {
  try {
    const { name, type, description, allowMultiple, required, order, slug } = req.body || {};
    const item = await Attribute.findByIdAndUpdate(
      req.params.id,
      { name, type, description, allowMultiple, required, order, slug },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    res.json(item);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update attribute' });
  }
};

export const deleteAttribute = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Attribute.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    await AttributeValue.deleteMany({ attribute: id });
    res.json({ message: 'Deleted', id });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete attribute' });
  }
};

// Values
export const listValues = async (req, res) => {
  try {
    const { attributeId } = req.params;
    const values = await AttributeValue.find({ attribute: attributeId }).sort({ order: 1, value: 1 });
    res.json(values);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load values' });
  }
};

export const createValue = async (req, res) => {
  try {
    const { attributeId } = req.params;
    const { value, meta, order, slug, isActive } = req.body;
    const exists = await AttributeValue.findOne({ attribute: attributeId, value: new RegExp(`^${String(value).trim()}$`, 'i') });
    if (exists) return res.status(400).json({ message: 'Value already exists for this attribute' });
    const v = new AttributeValue({ attribute: attributeId, value, meta, order, slug, isActive });
    const saved = await v.save();
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create value' });
  }
};

export const updateValue = async (req, res) => {
  try {
    const { id } = req.params; // value id
    const { value, meta, order, slug, isActive } = req.body || {};
    const updated = await AttributeValue.findByIdAndUpdate(id, { value, meta, order, slug, isActive }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Value not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update value' });
  }
};

export const deleteValue = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await AttributeValue.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ message: 'Value not found' });
    res.json({ message: 'Deleted', id });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete value' });
  }
};
