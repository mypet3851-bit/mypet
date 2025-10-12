import asyncHandler from 'express-async-handler';
import Brand from '../models/Brand.js';

export const listBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find().sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const listActiveBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  res.json(brands);
});

export const createBrand = asyncHandler(async (req, res) => {
  const { name, imageUrl, linkUrl, isActive = true, order = 0 } = req.body || {};
  const brand = await Brand.create({ name, imageUrl, linkUrl, isActive, order });
  res.status(201).json(brand);
});

export const updateBrand = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const brand = await Brand.findById(id);
  if (!brand) return res.status(404).json({ message: 'Brand not found' });
  const updatable = ['name', 'imageUrl', 'linkUrl', 'isActive', 'order'];
  updatable.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      brand[k] = req.body[k];
    }
  });
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
