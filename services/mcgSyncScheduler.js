// Periodic pull of inventory from MCG into local DB
// Uses Settings.mcg.autoPullEnabled and pullEveryMinutes to control cadence

import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Warehouse from '../models/Warehouse.js';
import { getItemsList } from './mcgService.js';
import { inventoryService } from './inventoryService.js';
import McgItemBlock from '../models/McgItemBlock.js';

let _timer = null;
let _inFlight = false;
let _lastRunAt = 0;

async function ensureMainWarehouse() {
  let wh = await Warehouse.findOne({ name: 'Main Warehouse' });
  if (!wh) {
    wh = await Warehouse.findOneAndUpdate(
      { name: 'Main Warehouse' },
      { $setOnInsert: { name: 'Main Warehouse' } },
      { new: true, upsert: true }
    );
  }
  return wh;
}

async function upsertInventoryFor({ productId, variantId, qty, size, color }) {
  const wh = await ensureMainWarehouse();
  const filter = variantId
    ? { product: productId, variantId, warehouse: wh?._id }
    : { product: productId, size: size || 'Default', color: color || 'Default', warehouse: wh?._id };
  const update = { $set: { quantity: Math.max(0, Number(qty) || 0) } };
  const opts = { new: true, upsert: true, setDefaultsOnInsert: true };
  const inv = await Inventory.findOneAndUpdate(filter, update, opts);
  await inventoryService.recomputeProductStock(productId);
  await new InventoryHistory({
    product: productId,
    type: 'update',
    quantity: Math.max(0, Number(qty) || 0),
    reason: 'MCG auto sync (pull)'
  }).save();
  return inv;
}

async function oneRun() {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const s = await Settings.findOne().lean();
    const mcg = s?.mcg || {};
    if (!mcg.enabled || !mcg.autoPullEnabled) return;

    const apiFlavor = String(mcg.apiFlavor || '').trim().toLowerCase();
    const baseUrl = String(mcg.baseUrl || '').trim();
    const isUpli = apiFlavor === 'uplicali' || /apis\.uplicali\.com/i.test(baseUrl) || /SuperMCG\/MCG_API/i.test(baseUrl);

    let processed = 0, updated = 0, created = 0, skippedNoMatch = 0, errors = 0, autoCreated = 0, skippedBlocked = 0;

    const blockCtx = {
      blockedBarcodes: new Set(),
      blockedItemIds: new Set()
    };
    try {
      const blockDocs = await McgItemBlock.find({}, 'barcode mcgItemId').lean();
      for (const doc of blockDocs || []) {
        const barcode = typeof doc?.barcode === 'string' ? doc.barcode.trim().toLowerCase() : '';
        const mcgId = typeof doc?.mcgItemId === 'string' ? doc.mcgItemId.trim().toLowerCase() : '';
        if (barcode) blockCtx.blockedBarcodes.add(barcode);
        if (mcgId) blockCtx.blockedItemIds.add(mcgId);
      }
    } catch (blockErr) {
      try { console.warn('[mcg][auto-pull] blocklist load failed:', blockErr?.message || blockErr); } catch {}
    }

    // Resolve default category for auto-created products (first existing or create 'Imported')
    let defaultCategoryId = null;
    if (mcg.autoCreateItemsEnabled) {
      try {
        const firstCat = await Category.findOne({}).select('_id name').sort({ createdAt: 1 });
        if (firstCat) defaultCategoryId = firstCat._id;
        if (!defaultCategoryId) {
          const imported = await Category.findOneAndUpdate(
            { name: 'Imported' },
            { $setOnInsert: { name: 'Imported', description: 'Auto-created category for MCG imported items' } },
            { new: true, upsert: true }
          ).select('_id');
          if (imported) defaultCategoryId = imported._id;
        }
      } catch (e) {
        try { console.warn('[mcg][auto-pull] failed to resolve default category:', e?.message || e); } catch {}
      }
    }

    const processItems = async (items) => {
      for (const it of items) {
        try {
          processed++;
          const mcgId = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
          const barcode = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
          const qty = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
          const qtySafe = Number.isFinite(qty) ? qty : 0;

          // Variant by barcode
          let prod = null; let variant = null; let matchedByMcgId = false;
          if (barcode) {
            prod = await Product.findOne({ 'variants.barcode': barcode }).select('_id variants');
            if (prod?.variants) {
              variant = prod.variants.find(v => String(v?.barcode || '').trim() === barcode);
            }
          }
          // Product barcode
          if (!prod && barcode) {
            prod = await Product.findOne({ mcgBarcode: barcode }).select('_id');
          }
          // Fallback non-variant by mcgItemId
          if (!prod && mcgId) {
            prod = await Product.findOne({ mcgItemId: mcgId }).select('_id mcgBarcode');
            if (prod) matchedByMcgId = true;
          }

          const normalizedBarcode = barcode ? barcode.toLowerCase() : '';
          const normalizedMcgId = mcgId ? mcgId.toLowerCase() : '';
          if (!prod && (
            (normalizedBarcode && blockCtx.blockedBarcodes.has(normalizedBarcode)) ||
            (normalizedMcgId && blockCtx.blockedItemIds.has(normalizedMcgId))
          )) {
            skippedBlocked++;
            continue;
          }

          if (matchedByMcgId && prod && barcode) {
            const stored = (prod.mcgBarcode || '').trim();
            if (stored !== barcode) {
              try {
                await Product.updateOne({ _id: prod._id }, { $set: { mcgBarcode: barcode } });
              } catch (updateErr) {
                try { console.warn('[mcg][auto-pull] failed to refresh mcgBarcode', updateErr?.message || updateErr); } catch {}
              }
            }
          }

          if (!prod) {
            // Optionally auto-create product record
            if (mcg.autoCreateItemsEnabled && defaultCategoryId) {
              try {
                // Improved field mapping: prefer ItemName/Name; fall back to ItemDescription/Description when name is missing or numeric-like (EAN-style)
                const numericLike = (s) => /^\d{8,}$/.test(String(s||''));
                let rawName = (it?.ItemName ?? it?.Name ?? it?.name ?? it?.item_name ?? '') + '';
                const descSourceFull = (it?.ItemDescription ?? it?.Description ?? it?.description ?? it?.LongDescription ?? '') + '';
                if (!rawName || numericLike(rawName)) {
                  rawName = descSourceFull || barcode || mcgId || 'Imported Item';
                }
                const name = rawName.trim().slice(0, 160) || 'Imported Item';
                const descSource = (descSourceFull || name) + '';
                const description = descSource.trim().length ? descSource.trim().slice(0, 5000) : name;
                const priceRaw = Number(it?.item_final_price ?? it?.finalPrice ?? it?.FinalPrice ?? it?.Price ?? it?.price ?? it?.item_price ?? 0);
                const taxMultiplier = Number(mcg?.taxMultiplier || 1.18);
                const price = Number.isFinite(priceRaw) ? Math.ceil(priceRaw * (taxMultiplier > 0 ? taxMultiplier : 1)) : 0;
                const imgCandidate = (it?.ImageUrl || it?.image_url || it?.ImageURL || it?.image || it?.Image || '') + '';
                // Configurable placeholder (Settings.mcg.autoCreatePlaceholderImage) or fallback inline SVG
                const placeholderCfg = (mcg?.autoCreatePlaceholderImage || '').trim();
                const placeholder = (placeholderCfg && /^(https?:\/\/|\/|data:image)/i.test(placeholderCfg))
                  ? placeholderCfg
                  : 'data:image/svg+xml;utf8,' + encodeURIComponent(
                      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">\n' +
                      '<rect width="600" height="600" fill="#eef2f7"/>\n' +
                      '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="38" fill="#64748b" font-family="Arial, sans-serif">Imported</text>\n' +
                      '</svg>'
                    );
                const images = [ (imgCandidate && /^(https?:\/\/|\/)/i.test(imgCandidate) ? imgCandidate : placeholder) ];
                const doc = new Product({
                  name,
                  description,
                  price,
                  stock: qtySafe,
                  images,
                  category: defaultCategoryId,
                  mcgItemId: mcgId || undefined,
                  mcgBarcode: barcode || undefined,
                  isNew: true
                });
                await doc.save();
                autoCreated++;
                prod = { _id: doc._id }; // allow inventory sync below
              } catch (ce) {
                // Duplicate key or validation errors -> skip silently to avoid blocking inventory sync
                skippedNoMatch++;
                continue;
              }
            } else {
              skippedNoMatch++;
              continue;
            }
          }

          if (variant && variant._id) {
            await upsertInventoryFor({ productId: prod._id, variantId: variant._id, qty: qtySafe });
            updated++;
          } else {
            const inv = await upsertInventoryFor({ productId: prod._id, qty: qtySafe, size: 'Default', color: 'Default' });
            if (inv?.wasNew) created++; else updated++;
          }
        } catch (e) {
          errors++;
        }
      }
    };

    // Test hook: allow injecting mock items via env var to avoid real MCG calls
    const mockEnv = process.env.MCG_MOCK_ITEMS;
    if (mockEnv) {
      try {
        let items = [];
        try {
          items = JSON.parse(mockEnv);
        } catch {
          try {
            const fs = await import('fs');
            if (fs.default && fs.default.existsSync(mockEnv)) {
              const raw = fs.default.readFileSync(mockEnv, 'utf8');
              items = JSON.parse(raw);
            }
          } catch {}
        }
        if (Array.isArray(items)) {
          await processItems(items);
          try { console.log('[mcg][auto-pull] used MCG_MOCK_ITEMS, count=%d', items.length); } catch {}
          _lastRunAt = Date.now();
          _inFlight = false;
          return;
        }
      } catch {}
    }

    if (isUpli) {
      const data = await getItemsList({});
      const items = Array.isArray(data?.items || data?.data || data?.Items) ? (data?.items || data?.data || data?.Items) : (Array.isArray(data) ? data : []);
      await processItems(items);
    } else {
      // Legacy flavor: optionally loop all pages when autoPullAllPages enabled; otherwise only first page (200 items)
      const pageSize = 200;
      if (mcg.autoPullAllPages) {
        let page = 1;
        while (true) {
          const data = await getItemsList({ PageNumber: page, PageSize: pageSize });
          const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
          if (!items.length) break;
          await processItems(items);
          if (items.length < pageSize) break; // last page
          page++;
          if (page > 100) break; // safety cap
        }
      } else {
        const data = await getItemsList({ PageNumber: 1, PageSize: pageSize });
        const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
        await processItems(items);
      }
    }

  try { console.log('[mcg][auto-pull] processed=%d updated=%d createdInv=%d autoCreatedProducts=%d skipped=%d skippedBlocklist=%d errors=%d', processed, updated, created, autoCreated, skippedNoMatch, skippedBlocked, errors); } catch {}
    _lastRunAt = Date.now();
  } catch (e) {
    try { console.warn('[mcg][auto-pull] failed:', e?.message || e); } catch {}
  } finally {
    _inFlight = false;
  }
}

export function startMcgSyncScheduler() {
  if (_timer) return;
  const tick = async () => {
    try {
      const s = await Settings.findOne().lean();
      const mcg = s?.mcg || {};
      const envForce = String(process.env.MCG_AUTO_PULL || '').toLowerCase() === 'true';
      const enabled = (mcg.enabled && (mcg.autoPullEnabled || envForce)) || (envForce && !!process.env.MCG_BASE_URL);
      if (!enabled) return; // not enabled
      const pullMinutesEnv = Number(process.env.MCG_PULL_MINUTES);
      const configuredMinutes = Number.isFinite(pullMinutesEnv) && pullMinutesEnv > 0
        ? pullMinutesEnv
        : (mcg.pullEveryMinutes !== undefined && mcg.pullEveryMinutes !== null ? mcg.pullEveryMinutes : 1);
      const intervalMs = Math.max(1, Number(configuredMinutes)) * 60 * 1000;
      if (!_lastRunAt || Date.now() - _lastRunAt >= intervalMs) {
        await oneRun();
      }
    } catch {}
  };
  _timer = setInterval(tick, 60 * 1000);
  try { _timer.unref?.(); } catch {}
  try { console.log('[mcg][auto-pull] scheduler started'); } catch {}
}

export function stopMcgSyncScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

// Admin-triggerable single run (useful for testing or forcing an immediate pull)
export async function runMcgSyncOnce() {
  await oneRun();
}
