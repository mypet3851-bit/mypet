import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { getItemsList } from '../services/mcgService.js';

const router = express.Router();

// Proxy to MCG get_items_list with OAuth2
// POST /api/mcg/items
router.post('/items', adminAuth, async (req, res) => {
  try {
    const { PageNumber, PageSize, Filter } = req.body || {};
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });
    const data = await getItemsList({ PageNumber, PageSize, Filter });
    res.json(data);
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ message: e?.message || 'mcg_items_failed' });
  }
});

export default router;

// Config endpoints
router.get('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    const m = s.mcg || {};
    res.json({
      enabled: !!m.enabled,
      baseUrl: m.baseUrl || 'https://api.mcgateway.com',
      apiFlavor: m.apiFlavor || '',
      clientId: m.clientId ? '***' : '',
      clientSecret: m.clientSecret ? '***' : '',
      scope: m.scope || '',
      apiVersion: m.apiVersion || 'v2.6',
      tokenUrl: m.tokenUrl || '',
      extraHeaderName: m.extraHeaderName || '',
      extraHeaderValue: m.extraHeaderValue ? '***' : '',
      vendorCode: m.vendorCode || '',
      retailerKey: m.retailerKey || '',
      retailerClientId: m.retailerClientId || ''
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'mcg_config_read_failed' });
  }
});

router.put('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne().sort({ updatedAt: -1 });
    if (!s) s = new Settings();
    const inc = req.body || {};
    s.mcg = s.mcg || { enabled: false, baseUrl: 'https://api.mcgateway.com', clientId: '', clientSecret: '', scope: '', apiVersion: 'v2.6' };
    if (typeof inc.enabled !== 'undefined') s.mcg.enabled = !!inc.enabled;
    if (typeof inc.apiFlavor === 'string') s.mcg.apiFlavor = inc.apiFlavor.trim().toLowerCase();
    if (typeof inc.baseUrl === 'string') {
      let b = (inc.baseUrl || '').trim();
      if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b;
      // Validate URL format. For 'uplicali' flavor keep full path; otherwise strip to origin only.
      try {
        const u = new URL(b);
        if ((s.mcg.apiFlavor || '').toLowerCase() === 'uplicali') {
          s.mcg.baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname.replace(/\/$/, '')}`;
        } else {
          s.mcg.baseUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
        }
      } catch {
        return res.status(400).json({ message: 'Invalid baseUrl. For legacy use origin like https://api.mcgateway.com; for Uplîcali you may include /SuperMCG/MCG_API.' });
      }
    }
    if (typeof inc.clientId === 'string') {
      if (inc.clientId !== '***') s.mcg.clientId = inc.clientId.trim();
    }
    if (typeof inc.clientSecret === 'string') {
      if (inc.clientSecret !== '***') s.mcg.clientSecret = inc.clientSecret.trim();
    }
    if (typeof inc.scope === 'string') s.mcg.scope = inc.scope.trim();
    if (typeof inc.apiVersion === 'string') s.mcg.apiVersion = inc.apiVersion.trim();
    if (typeof inc.tokenUrl === 'string') {
      let t = (inc.tokenUrl || '').trim();
      if (t) {
        if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
        try {
          const u = new URL(t);
          // Keep full path for token URL since Azure AD includes a path
          s.mcg.tokenUrl = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
        } catch {
          return res.status(400).json({ message: 'Invalid tokenUrl. Example: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token' });
        }
      } else {
        s.mcg.tokenUrl = '';
      }
    }
    if (typeof inc.extraHeaderName === 'string') s.mcg.extraHeaderName = inc.extraHeaderName.trim();
    if (typeof inc.extraHeaderValue === 'string') {
      if (inc.extraHeaderValue !== '***') s.mcg.extraHeaderValue = inc.extraHeaderValue.trim();
    }
    if (typeof inc.vendorCode === 'string') s.mcg.vendorCode = inc.vendorCode.trim();
    if (typeof inc.retailerKey === 'string') s.mcg.retailerKey = inc.retailerKey.trim();
    if (typeof inc.retailerClientId === 'string') s.mcg.retailerClientId = inc.retailerClientId.trim();
    try { s.markModified('mcg'); } catch {}
    await s.save();
    res.json({
      enabled: s.mcg.enabled,
      baseUrl: s.mcg.baseUrl,
      apiFlavor: s.mcg.apiFlavor || '',
      clientId: s.mcg.clientId ? '***' : '',
      clientSecret: s.mcg.clientSecret ? '***' : '',
      scope: s.mcg.scope || '',
      apiVersion: s.mcg.apiVersion || 'v2.6',
      tokenUrl: s.mcg.tokenUrl || '',
      extraHeaderName: s.mcg.extraHeaderName || '',
      extraHeaderValue: s.mcg.extraHeaderValue ? '***' : '',
      vendorCode: s.mcg.vendorCode || '',
      retailerKey: s.mcg.retailerKey || '',
      retailerClientId: s.mcg.retailerClientId || ''
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'mcg_config_update_failed' });
  }
});

// Import items from MCG into Products (create-only, skip duplicates)
router.post('/sync-items', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    const { defaultCategoryId, page, pageSize, dryRun } = req.body || {};
    const dry = !!dryRun || String(req.query?.dryRun || '').toLowerCase() === 'true';

    // Fetch one page for now; pagination loop can be added later
    const data = await getItemsList({ PageNumber: page, PageSize: pageSize, Filter: req.body?.Filter });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
    const totalCount = Number(data?.TotalCount || items.length || 0);

    // Build dedupe sets from incoming data
    const ids = items.map(it => (it?.ItemID ?? it?.id ?? it?.itemId ?? '') + '').map(v => v.trim()).filter(Boolean);
    const barcodes = items.map(it => (it?.Barcode ?? it?.barcode ?? '') + '').map(v => v.trim()).filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));
    const uniqueBarcodes = Array.from(new Set(barcodes));

    const existing = await Product.find({ $or: [
      uniqueIds.length ? { mcgItemId: { $in: uniqueIds } } : null,
      uniqueBarcodes.length ? { mcgBarcode: { $in: uniqueBarcodes } } : null
    ].filter(Boolean) }).select('mcgItemId mcgBarcode');
    const existId = new Set(existing.map(p => (p.mcgItemId || '').toString()));
    const existBarcode = new Set(existing.map(p => (p.mcgBarcode || '').toString()));

    // Determine category
    let categoryId = null;
    if (typeof defaultCategoryId === 'string' && /^[a-fA-F0-9]{24}$/.test(defaultCategoryId)) {
      const ok = await Category.findById(defaultCategoryId).select('_id');
      if (ok) categoryId = ok._id;
    }
    if (!categoryId) {
      const first = await Category.findOne({}).select('_id').sort({ createdAt: 1 });
      if (first) categoryId = first._id;
    }
    if (!categoryId) return res.status(400).json({ message: 'No category available; create a category first or pass defaultCategoryId' });

    // Map
    const toInsert = [];
    let skippedByMissingKey = 0;
    let skippedAsDuplicate = 0;
    for (const it of items) {
      const mcgId = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
      const barcode = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
      if (!mcgId && !barcode) { skippedByMissingKey++; continue; }
      if ((mcgId && existId.has(mcgId)) || (barcode && existBarcode.has(barcode))) { skippedAsDuplicate++; continue; }
  const name = (it?.Name ?? it?.name ?? it?.item_name ?? (barcode || mcgId || 'MCG Item')) + '';
      const desc = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : 'Imported from MCG')) + '';
      const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
      const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
      const stockRaw = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
      const stock = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
      const img = (it?.ImageURL ?? it?.imageUrl ?? (it?.item_image || '')) + '';
      const imgOk = /^(https?:\/\/|\/)/i.test(img) ? img : '';
      const images = imgOk ? [imgOk] : ['/placeholder-image.svg'];
      const doc = {
        name,
        description: desc,
        price,
        images,
        category: categoryId,
        stock,
        relatedProducts: [],
        isActive: true,
        mcgItemId: mcgId || undefined,
        mcgBarcode: barcode || undefined
      };
      toInsert.push(doc);
    }

    if (dry) {
      return res.json({
        dryRun: true,
        page: Number(page)||1,
        pageSize: Number(pageSize)||items.length,
        totalCount,
        incoming: items.length,
        uniqueIds: uniqueIds.length,
        uniqueBarcodes: uniqueBarcodes.length,
        existingById: existId.size,
        existingByBarcode: existBarcode.size,
        toInsert: toInsert.length,
        skippedByMissingKey,
        skippedAsDuplicate,
        sampleNew: toInsert.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode }))
      });
    }

    let created = [];
    if (toInsert.length) {
      created = await Product.insertMany(toInsert, { ordered: false }).catch((e) => {
        if (e?.writeErrors) {
          const inserted = e.result?.nInserted || 0;
          return toInsert.slice(0, inserted);
        }
        throw e;
      });
    }
    res.json({
      page: Number(page)||1,
      pageSize: Number(pageSize)||items.length,
      totalCount,
      created: created.length,
      skipped: items.length - created.length,
      skippedByMissingKey,
      skippedAsDuplicate,
      sampleNew: toInsert.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode }))
    });
  } catch (e) {
    res.status(400).json({ message: e?.message || 'mcg_sync_items_failed' });
  }
});

// Sync a single existing product from MCG by mcgItemId or mcgBarcode
router.post('/sync-product/:productId', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne();
    if (!s?.mcg?.enabled) return res.status(412).json({ message: 'MCG integration disabled' });

    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Determine lookup keys: prefer explicit override, then saved mapping on product
    let mcgItemId = (req.body?.mcgItemId || product.mcgItemId || '').toString().trim();
    let mcgBarcode = (req.body?.mcgBarcode || product.mcgBarcode || '').toString().trim();
    if (!mcgItemId && !mcgBarcode) {
      return res.status(400).json({ message: 'Provide mcgItemId or mcgBarcode on the product or in request body' });
    }

    const Filter = mcgItemId ? { ItemID: mcgItemId } : { Barcode: mcgBarcode };
    const data = await getItemsList({ PageNumber: 1, PageSize: 1, Filter });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
    if (!items.length) return res.status(404).json({ message: 'No matching item found in MCG' });
    const it = items[0] || {};

    // Map fields
  const nameFromMcg = (it?.Name ?? it?.name ?? it?.item_name ?? '').toString();
  const descFromMcg = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : '')).toString();
  const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
    const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : undefined;
  const barcodeFromMcg = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
  const idFromMcg = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();

    const update = {};
    // Only overwrite name if empty or placeholder
    if ((!product.name || product.name === 'MCG Item') && nameFromMcg) update.name = nameFromMcg;
    if (descFromMcg) update.description = descFromMcg;
    if (typeof price === 'number') update.price = price;
    if (idFromMcg) update.mcgItemId = idFromMcg;
    if (barcodeFromMcg) update.mcgBarcode = barcodeFromMcg;

    const updated = await Product.findByIdAndUpdate(productId, { $set: update }, { new: true });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'mcg_sync_product_failed' });
  }
});
