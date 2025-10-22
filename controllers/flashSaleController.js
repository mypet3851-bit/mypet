import FlashSale from '../models/FlashSale.js';
import Product from '../models/Product.js';
import { getStoreCurrency } from '../services/storeCurrencyService.js';
import { deepseekTranslate, isDeepseekConfigured } from '../services/translate/deepseek.js';

export const listAdmin = async (req, res) => {
  try {
    const sales = await FlashSale.find()
      .sort({ startDate: -1 })
      .populate({
        path: 'items.product',
        // Provide minimal fields needed by admin UI to render base price and thumbnail
        select: 'name images colors attributeImages price originalPrice'
      })
      .lean();
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
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const now = new Date();
    const sales = await FlashSale.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .populate({
        path: 'items.product',
          // Include attributeImages so storefront can show per-attribute images on flash cards
          select: 'name images colors attributeImages price originalPrice',
      })
      .lean();

    // Localize embedded products (name) if lang provided; persist missing translations when DeepSeek configured
    const out = await Promise.all(sales.map(async (s) => {
      const items = await Promise.all((s.items || []).map(async (it) => {
        const p = it.product;
        if (p && reqLang) {
          try {
            const pDoc = await Product.findById(p._id).select('name description name_i18n description_i18n');
            if (pDoc) {
              const nm = (pDoc.name_i18n && (typeof pDoc.name_i18n.get === 'function' ? pDoc.name_i18n.get(reqLang) : pDoc.name_i18n[reqLang])) || null;
              if (nm) {
                p.name = nm;
              } else if (allowAutoTranslate && typeof pDoc.name === 'string' && pDoc.name.trim()) {
                try {
                  const tr = await deepseekTranslate(pDoc.name, 'auto', reqLang);
                  const map = new Map(pDoc.name_i18n || []);
                  map.set(reqLang, tr);
                  pDoc.name_i18n = map;
                  p.name = tr;
                  try { await pDoc.save(); } catch {}
                } catch {}
              }
            }
          } catch {}
        }
        return {
          product: p,
          flashPrice: it.flashPrice,
          quantityLimit: it.quantityLimit,
          order: it.order
        };
      }));

      return {
        _id: s._id,
        name: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        pricingMode: s.pricingMode || 'fixed',
        discountPercent: s.discountPercent,
        items
      };
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
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const { id } = req.params;
    const now = new Date();
    const s = await FlashSale.findOne({ _id: id, active: true, startDate: { $lte: now }, endDate: { $gte: now } })
      .populate({
        path: 'items.product',
          select: 'name images colors attributeImages price originalPrice',
      })
      .lean();
    if (!s) return res.status(404).json({ message: 'Flash sale not found or not active' });
    const items = await Promise.all((s.items || []).map(async (it) => {
      const p = it.product;
      if (p && reqLang) {
        try {
          const pDoc = await Product.findById(p._id).select('name description name_i18n description_i18n');
          if (pDoc) {
            const nm = (pDoc.name_i18n && (typeof pDoc.name_i18n.get === 'function' ? pDoc.name_i18n.get(reqLang) : pDoc.name_i18n[reqLang])) || null;
            if (nm) {
              p.name = nm;
            } else if (allowAutoTranslate && typeof pDoc.name === 'string' && pDoc.name.trim()) {
              try {
                const tr = await deepseekTranslate(pDoc.name, 'auto', reqLang);
                const map = new Map(pDoc.name_i18n || []);
                map.set(reqLang, tr);
                pDoc.name_i18n = map;
                p.name = tr;
                try { await pDoc.save(); } catch {}
              } catch {}
            }
          }
        } catch {}
      }
      return {
        product: p,
        flashPrice: it.flashPrice,
        quantityLimit: it.quantityLimit,
        order: it.order,
      };
    }));

    const out = {
      _id: s._id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      pricingMode: s.pricingMode || 'fixed',
      discountPercent: s.discountPercent,
      items,
    };
    try { const c = await getStoreCurrency(); res.set('X-Store-Currency', c); } catch {}
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load flash sale' });
  }
};
