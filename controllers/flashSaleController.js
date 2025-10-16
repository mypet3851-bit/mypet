import FlashSale from '../models/FlashSale.js';
import { getStoreCurrency } from '../services/storeCurrencyService.js';

export const listAdmin = async (req, res) => {
  try {
    const sales = await FlashSale.find().sort({ startDate: -1 });
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(sales);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sales' });
  }
};

export const create = async (req, res) => {
  try {
    const body = req.body || {};
    const sale = await FlashSale.create(body);
    res.status(201).json(sale);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create' });
  }
};

export const update = async (req, res) => {
  try {
    const updated = await FlashSale.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update' });
  }
};

export const remove = async (req, res) => {
  try {
    const doc = await FlashSale.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete' });
  }
};

export const publicActiveList = async (req, res) => {
  try {
    const now = new Date();
    const sales = await FlashSale.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .populate({
        path: 'items.product',
        select: 'name images colors price originalPrice',
      })
      .lean();

    // Map to shape expected by mobile (while keeping flexible)
    const out = sales.map(s => ({
      _id: s._id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      items: (s.items || []).map(it => ({
        product: it.product,
        flashPrice: it.flashPrice,
        quantityLimit: it.quantityLimit,
        order: it.order
      }))
    }));
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sales' });
  }
};

// Public: get a specific active flash sale by id (only returns if currently active)
export const publicGetById = async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const s = await FlashSale.findOne({ _id: id, active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .populate({
        path: 'items.product',
        select: 'name images colors price originalPrice',
      })
      .lean();
    if (!s) return res.status(404).json({ message: 'Flash sale not found or not active' });
    const out = {
      _id: s._id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      items: (s.items || []).map((it) => ({
        product: it.product,
        flashPrice: it.flashPrice,
        quantityLimit: it.quantityLimit,
        order: it.order,
      })),
    };
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sale' });
  }
};
