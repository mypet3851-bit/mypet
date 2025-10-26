import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { getItemsList } from '../services/mcgService.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Warehouse from '../models/Warehouse.js';
import { inventoryService } from '../services/inventoryService.js';

const router = express.Router();

// Public health ping (no auth). Returns a simple OK to verify routing reaches this service.
router.get('/ping', (req, res) => {
  res.json({ ok: true, service: 'mcg', timestamp: new Date().toISOString() });
});

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
  retailerKey: m.retailerKey ? '***' : '',
      retailerClientId: m.retailerClientId || '',
      taxMultiplier: typeof m.taxMultiplier === 'number' ? m.taxMultiplier : 1.18,
      pushStockBackEnabled: !!m.pushStockBackEnabled
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
    if (typeof inc.retailerKey === 'string') {
      if (inc.retailerKey !== '***') s.mcg.retailerKey = inc.retailerKey.trim();
    }
    if (typeof inc.retailerClientId === 'string') s.mcg.retailerClientId = inc.retailerClientId.trim();
    if (typeof inc.taxMultiplier !== 'undefined') {
      const t = Number(inc.taxMultiplier);
      if (Number.isFinite(t) && t >= 1) s.mcg.taxMultiplier = t;
    }
    if (typeof inc.pushStockBackEnabled !== 'undefined') s.mcg.pushStockBackEnabled = !!inc.pushStockBackEnabled;
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
  retailerKey: s.mcg.retailerKey ? '***' : '',
      retailerClientId: s.mcg.retailerClientId || '',
      taxMultiplier: typeof s.mcg.taxMultiplier === 'number' ? s.mcg.taxMultiplier : 1.18,
      pushStockBackEnabled: !!s.mcg.pushStockBackEnabled
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

  const { defaultCategoryId, page, pageSize, dryRun, syncAll } = req.body || {};
    const dry = !!dryRun || String(req.query?.dryRun || '').toLowerCase() === 'true';

    // Pagination loop: when syncAll=true or page/pageSize not provided, iterate through all pages
    const doLoop = !!syncAll || !Number.isFinite(Number(page)) || !Number.isFinite(Number(pageSize));
    const effPageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 200;
    let pageNum = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    let totalCount = 0;

    // Accumulators across pages
  const createdAll = [];
  let skippedByMissingKey = 0;
  let skippedAsDuplicate = 0;
  let incomingTotal = 0;
  // Maintain seen set across the whole run to avoid duplicates across pages (by mcgItemId only)
  const seenIds = new Set();

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

    const taxMultiplier = Number(s?.mcg?.taxMultiplier || 1.18);

    // Helper to process a single page of results
    const processPage = async (items) => {
      // Build per-page dedupe sets and fetch existing once per page
      const ids = items.map(it => (it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').map(v => v.trim()).filter(Boolean);
      const uniqueIds = Array.from(new Set(ids));

      const existing = await Product.find({ $or: [
        uniqueIds.length ? { mcgItemId: { $in: uniqueIds } } : null
      ].filter(Boolean) }).select('mcgItemId');
      const existId = new Set(existing.map(p => (p.mcgItemId || '').toString()));

      const toInsert = [];
      for (const it of items) {
      const mcgId = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
      const barcode = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
        if (!mcgId && !barcode) { skippedByMissingKey++; continue; }
  // Duplicate rule (updated): dedupe ONLY by mcgItemId. Barcode duplicates are allowed by request.
  const isDupById = mcgId && (existId.has(mcgId) || seenIds.has(mcgId));
  if (isDupById) { skippedAsDuplicate++; continue; }
  const name = (it?.Name ?? it?.name ?? it?.item_name ?? (barcode || mcgId || 'MCG Item')) + '';
      const desc = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : 'Imported from MCG')) + '';
      // Prefer provider's final (VAT-inclusive) price when available; otherwise apply configured tax multiplier
      let price = 0;
      if (it && (it.item_final_price !== undefined && it.item_final_price !== null)) {
        const pf = Number(it.item_final_price);
        price = Number.isFinite(pf) && pf >= 0 ? pf : 0;
      } else {
        const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
        const base = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
        price = Math.round(base * taxMultiplier * 100) / 100;
      }
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
        // Mark keys as seen to prevent duplicates within the same run
  if (mcgId) seenIds.add(mcgId);
      }

      incomingTotal += items.length;
      if (dry) {
        return { toInsert, created: [], insertedCount: 0 };
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
      createdAll.push(...created);
      return { toInsert, created, insertedCount: created.length };
    };

    // Loop pages
    let iterations = 0;
    while (true) {
      const data = await getItemsList({ PageNumber: pageNum, PageSize: effPageSize, Filter: req.body?.Filter });
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
      if (!totalCount) totalCount = Number(data?.TotalCount || 0) || 0;
      if (!items || items.length === 0) break;
      await processPage(items);
      if (!doLoop) break; // single page mode
      // stop if this was the last page
      if (items.length < effPageSize) break;
      pageNum += 1;
      iterations += 1;
      if (iterations > 10000) break; // absolute safety
    }

    if (dry) {
      return res.json({
        dryRun: true,
        page: Number(page)||1,
        pageSize: Number(pageSize)||effPageSize,
        totalCount,
        incoming: incomingTotal,
        uniqueIds: undefined,
        uniqueBarcodes: undefined,
        existingById: undefined,
        existingByBarcode: undefined,
        toInsert: createdAll.length,
        skippedByMissingKey,
        skippedAsDuplicate,
        sampleNew: createdAll.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode }))
      });
    }

    // After creating products, create initial inventory rows per product in Main Warehouse
    if (createdAll.length) {
      try {
        // Ensure at least one warehouse exists
        let warehouses = await Warehouse.find({});
        if (!warehouses || warehouses.length === 0) {
          const main = await Warehouse.findOneAndUpdate(
            { name: 'Main Warehouse' },
            { $setOnInsert: { name: 'Main Warehouse' } },
            { new: true, upsert: true }
          );
          warehouses = main ? [main] : [];
        }
        const mainWh = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
        if (mainWh && createdAll.length) {
          // Build inventory docs for created products
          const invDocs = createdAll.map(p => new Inventory({
            product: p._id,
            size: 'Default',
            color: 'Default',
            quantity: Math.max(0, Number(p?.stock) || 0),
            warehouse: mainWh._id,
            location: mainWh.name,
            lowStockThreshold: 5
          }));
          // Insert inventory rows (ignore duplicates if any)
          if (invDocs.length) {
            try {
              await Inventory.insertMany(invDocs, { ordered: false });
            } catch (invErr) {
              // tolerate partial insertion errors
              try { console.warn('[mcg][sync-items] inventory insert partial', invErr?.message || invErr); } catch {}
            }
          }
          // Create history entries
          const historyDocs = createdAll.map(p => new InventoryHistory({
            product: p._id,
            type: 'increase',
            quantity: Math.max(0, Number(p?.stock) || 0),
            reason: 'Initial stock (MCG import)',
            user: req.user?._id
          }));
          try { if (historyDocs.length) await InventoryHistory.insertMany(historyDocs, { ordered: false }); } catch {}
          // Recompute product stocks to reflect inserted inventory
          try {
            for (const p of createdAll) {
              try { await inventoryService.recomputeProductStock(p._id); } catch {}
            }
          } catch {}
        }
      } catch (invSetupErr) {
        try { console.warn('[mcg][sync-items] warehouse/inventory setup skipped:', invSetupErr?.message || invSetupErr); } catch {}
      }
    }
    res.json({
      page: Number(page)||1,
      pageSize: Number(pageSize)||effPageSize,
      totalCount,
      created: createdAll.length,
      skipped: Math.max(0, incomingTotal - createdAll.length),
      skippedByMissingKey,
      skippedAsDuplicate,
      sampleNew: createdAll.slice(0, 3).map(x => ({ name: x.name, mcgItemId: x.mcgItemId, mcgBarcode: x.mcgBarcode }))
    });
  } catch (e) {
    const status = e?.status || e?.response?.status || 400;
    res.status(status).json({ message: e?.message || 'mcg_sync_items_failed' });
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

    // Fetch items. For Uplîcali flavor the service ignores Filter and returns the whole list,
    // so we must match client-side by id/barcode.
    const Filter = mcgItemId ? { ItemID: mcgItemId } : { Barcode: mcgBarcode };
    const data = await getItemsList({ PageNumber: 1, PageSize: 1, Filter });
    const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data?.items) ? data.items : []);
    // Try to match exact item by various possible field names
    const norm = (v) => (v === undefined || v === null) ? '' : String(v).trim();
    const wantedId = norm(mcgItemId);
    const wantedBarcode = norm(mcgBarcode);
    const it = items.find(raw => {
      const id = norm(raw?.ItemID ?? raw?.id ?? raw?.itemId ?? raw?.item_id);
      const bc = norm(raw?.Barcode ?? raw?.barcode ?? raw?.item_code);
      return (wantedId && id && id === wantedId) || (wantedBarcode && bc && bc === wantedBarcode);
    }) || {};
    if (!Object.keys(it).length) return res.status(404).json({ message: 'No matching item found in MCG' });

    // Map fields
  const nameFromMcg = (it?.Name ?? it?.name ?? it?.item_name ?? '').toString();
  const descFromMcg = (it?.Description ?? it?.description ?? (it?.item_department ? `Department: ${it.item_department}` : '')).toString();
    const taxMultiplier = Number(s?.mcg?.taxMultiplier || 1.18);
    let price;
    if (it && (it.item_final_price !== undefined && it.item_final_price !== null)) {
      const pf = Number(it.item_final_price);
      price = Number.isFinite(pf) && pf >= 0 ? Math.round(pf * 100) / 100 : undefined;
    } else {
      const priceRaw = Number(it?.Price ?? it?.price ?? it?.item_price ?? 0);
      const base = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : undefined;
      price = typeof base === 'number' ? Math.round(base * taxMultiplier * 100) / 100 : undefined;
    }
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

    // Also upsert inventory using item inventory from MCG (if available)
    try {
      const qtyRaw = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? it?.qty ?? 0);
      const quantity = Number.isFinite(qtyRaw) ? Math.max(0, qtyRaw) : 0;
      // Resolve warehouse (create Main Warehouse if needed)
      let warehouses = await Warehouse.find({});
      if (!warehouses || warehouses.length === 0) {
        const main = await Warehouse.findOneAndUpdate(
          { name: 'Main Warehouse' },
          { $setOnInsert: { name: 'Main Warehouse' } },
          { new: true, upsert: true }
        );
        warehouses = main ? [main] : [];
      }
      if (warehouses && warehouses.length) {
        const mainWh = warehouses.find(w => String(w?.name || '').toLowerCase() === 'main warehouse') || warehouses[0];
        // If product has variants, try smart mapping:
        // 1) If a variant barcode matches MCG barcode -> update that variant row
        // 2) Else if exactly one variant exists -> update that variant row
        // 3) Else fallback to Default/Default non-variant row
        let didVariant = false;
        try {
          const prod = await Product.findById(productId).select('variants').lean();
          const variants = Array.isArray(prod?.variants) ? prod.variants : [];
          let targetVariantId = null;
          if (variants.length > 0) {
            // Try barcode match first
            if (barcodeFromMcg) {
              const match = variants.find(v => String(v?.barcode || '').trim() === barcodeFromMcg);
              if (match && match._id) targetVariantId = String(match._id);
            }
            // If none matched and there is exactly one variant, use it
            if (!targetVariantId && variants.length === 1 && variants[0]?._id) {
              targetVariantId = String(variants[0]._id);
            }
          }
          if (targetVariantId) {
            const filterVar = { product: productId, variantId: targetVariantId, warehouse: mainWh._id };
            const setOnInsert = { product: productId, variantId: targetVariantId, warehouse: mainWh._id };
            await Inventory.findOneAndUpdate(
              filterVar,
              { $set: { quantity }, $setOnInsert: setOnInsert },
              { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            );
            didVariant = true;
          }
        } catch {}

        if (!didVariant) {
          const filter = { product: productId, size: 'Default', color: 'Default', warehouse: mainWh._id };
          const updateInv = { $set: { quantity }, $setOnInsert: { product: productId, size: 'Default', color: 'Default', warehouse: mainWh._id } };
          await Inventory.findOneAndUpdate(filter, updateInv, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
        }
        try { await inventoryService.recomputeProductStock(productId); } catch {}
      }
    } catch (invErr) {
      try { console.warn('[mcg][sync-product] inventory upsert skipped:', invErr?.message || invErr); } catch {}
    }

    res.json(updated);
  } catch (e) {
    const status = e?.status || e?.response?.status || 400;
    res.status(status).json({ message: e?.message || 'mcg_sync_product_failed' });
  }
});
