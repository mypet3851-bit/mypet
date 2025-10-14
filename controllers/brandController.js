import asyncHandler from 'express-async-handler';
import Brand from '../models/Brand.js';

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const listBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find().sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const listActiveBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const createBrand = asyncHandler(async (req, res) => {
  const { name, slug, imageUrl, linkUrl, isActive = true, order = 0 } = req.body || {};
  const normalizedSlug = slug ? String(slug).trim().toLowerCase() : (name ? slugify(name) : undefined);
  const brand = await Brand.create({ name, slug: normalizedSlug, imageUrl, linkUrl, isActive, order });
  res.status(201).json(brand);
});

export const updateBrand = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const brand = await Brand.findById(id);
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  const updatable = ['name', 'slug', 'imageUrl', 'linkUrl', 'isActive', 'order'];
  updatable.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      const val = req.body[k];
      if (k === 'slug' && typeof val === 'string') brand[k] = val.trim().toLowerCase();
      else brand[k] = val;
    }
  });
  // If slug absent but name provided and brand has no slug yet, generate
  if (!('slug' in (req.body || {})) && typeof req.body?.name === 'string' && !brand.slug) {
    brand.slug = slugify(req.body.name);
  }
  await brand.save();
  res.json(brand);
});

export const deleteBrand = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const brand = await Brand.findById(id);
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  await brand.deleteOne();
  res.json({ success: true });
});

export const reorderBrands = asyncHandler(async (req, res) => {
  const { order } = req.body; // [{id, order}, ...]
  if (!Array.isArray(order)) return res.status(400).json({ message: 'Invalid order payload' });
  const ops = order.map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } } }));
  if (ops.length) await Brand.bulkWrite(ops);
  const brands = await Brand.find().sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const getBrandBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ message: 'Slug is required' });
  const brand = await Brand.findOne({ slug: String(slug).toLowerCase() });
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  res.json(brand);
});
