// Periodic pull of inventory from MCG into local DB
// Uses Settings.mcg.autoPullEnabled and pullEveryMinutes to control cadence

import Settings from '../models/Settings.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Warehouse from '../models/Warehouse.js';
import { getItemsList } from './mcgService.js';
import { inventoryService } from './inventoryService.js';

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

    let processed = 0, updated = 0, created = 0, skippedNoMatch = 0, errors = 0;

    const processItems = async (items) => {
      for (const it of items) {
        try {
          processed++;
          const mcgId = ((it?.ItemID ?? it?.id ?? it?.itemId ?? it?.item_id ?? '') + '').trim();
          const barcode = ((it?.Barcode ?? it?.barcode ?? it?.item_code ?? '') + '').trim();
          const qty = Number(it?.StockQuantity ?? it?.stock ?? it?.item_inventory ?? 0);
          const qtySafe = Number.isFinite(qty) ? qty : 0;

          // Variant by barcode
          let prod = null; let variant = null;
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
            prod = await Product.findOne({ mcgItemId: mcgId }).select('_id');
          }

          if (!prod) { skippedNoMatch++; continue; }

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

    if (isUpli) {
      const data = await getItemsList({});
      const items = Array.isArray(data?.items || data?.data || data?.Items) ? (data?.items || data?.data || data?.Items) : (Array.isArray(data) ? data : []);
      await processItems(items);
    } else {
      // Legacy: pull one page of 200 to reduce load; admin can run full sync endpoint for all pages
      const data = await getItemsList({ PageNumber: 1, PageSize: 200 });
      const items = Array.isArray(data?.Items) ? data.Items : (Array.isArray(data) ? data : []);
      await processItems(items);
    }

    try { console.log('[mcg][auto-pull] processed=%d updated=%d created=%d skipped=%d errors=%d', processed, updated, created, skippedNoMatch, errors); } catch {}
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
      if (!mcg.enabled || !mcg.autoPullEnabled) return; // not enabled
      const intervalMs = Math.max(1, Number(mcg.pullEveryMinutes || 15)) * 60 * 1000;
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
