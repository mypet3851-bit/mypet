import McgItemBlock from '../models/McgItemBlock.js';
import Settings from '../models/Settings.js';
import { deleteItems as deleteMcgItems } from './mcgService.js';

const normalize = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

function pushIfPresent(set, raw) {
  const normalized = normalize(raw);
  if (normalized) set.add(normalized);
}

function coerceArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input];
}

export function collectMcgIdentifiers(productDoc, options = {}) {
  const {
    includeVariants = true,
    additionalIdentifiers = [],
    overrideMcgItemId,
    overrideBarcode
  } = options;
  const mcgIds = new Set();
  const barcodes = new Set();

  if (productDoc) {
    pushIfPresent(mcgIds, productDoc.mcgItemId);
    pushIfPresent(barcodes, productDoc.mcgBarcode);
    if (includeVariants && Array.isArray(productDoc.variants)) {
      for (const variant of productDoc.variants) {
        pushIfPresent(barcodes, variant?.barcode);
        pushIfPresent(mcgIds, variant?.mcgItemId);
      }
    }
  }

  if (overrideMcgItemId) pushIfPresent(mcgIds, overrideMcgItemId);
  if (overrideBarcode) pushIfPresent(barcodes, overrideBarcode);

  for (const extra of coerceArray(additionalIdentifiers)) {
    if (!extra) continue;
    if (typeof extra === 'string') {
      pushIfPresent(barcodes, extra);
      continue;
    }
    if (typeof extra === 'object') {
      pushIfPresent(mcgIds, extra?.mcgItemId ?? extra?.item_id ?? extra?.itemId ?? extra?.id);
      pushIfPresent(barcodes, extra?.mcgBarcode ?? extra?.barcode ?? extra?.item_code ?? extra?.itemCode ?? extra?.code);
    }
  }

  return { mcgIds, barcodes };
}

export async function persistMcgBlocklistEntries(productDoc, userId, reason = 'hard_delete', options = {}) {
  const { identifiers, includeVariants = true, additionalIdentifiers, overrideMcgItemId, overrideBarcode, noteOverride } = options;
  const collected = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const { mcgIds, barcodes } = collected;
  if (!mcgIds.size && !barcodes.size) return;

  const defaultNote = reason === 'soft_delete'
    ? 'Auto-blocked because product was soft deleted'
    : reason === 'manual_delete'
      ? 'Manually blocked via MCG delete action'
      : 'Auto-blocked because product was hard deleted';
  const note = typeof noteOverride === 'string' && noteOverride.trim() ? noteOverride.trim() : defaultNote;

  const insertBase = {
    reason,
    lastProductId: productDoc?._id,
    lastProductName: productDoc?.name || '',
    notes: note,
    ...(userId ? { createdBy: userId } : {})
  };
  const updateBase = {
    reason,
    lastProductId: productDoc?._id,
    lastProductName: productDoc?.name || '',
    notes: note,
    ...(userId ? { updatedBy: userId } : {})
  };

  const ops = [];
  for (const mcgId of mcgIds) {
    ops.push(
      McgItemBlock.findOneAndUpdate(
        { mcgItemId: mcgId },
        {
          $set: { ...updateBase, mcgItemId: mcgId },
          $setOnInsert: { ...insertBase, mcgItemId: mcgId }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }
  for (const barcode of barcodes) {
    ops.push(
      McgItemBlock.findOneAndUpdate(
        { barcode },
        {
          $set: { ...updateBase, barcode },
          $setOnInsert: { ...insertBase, barcode }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    );
  }

  await Promise.allSettled(ops);
}

export async function propagateMcgDeletion(productDoc, options = {}) {
  const {
    identifiers,
    includeVariants = true,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode,
    settingsDoc,
    groupOverride,
    allowWhenDisabled = false
  } = options;

  const collected = identifiers || collectMcgIdentifiers(productDoc, {
    includeVariants,
    additionalIdentifiers,
    overrideMcgItemId,
    overrideBarcode
  });
  const { mcgIds, barcodes } = collected;
  if (!mcgIds.size && !barcodes.size) {
    return { skipped: true, reason: 'no_identifiers' };
  }

  const payload = [];
  for (const mcgId of mcgIds) payload.push({ item_id: mcgId });
  for (const barcode of barcodes) payload.push({ item_code: barcode });

  let resolvedGroup = Number.isFinite(Number(groupOverride)) ? Number(groupOverride) : undefined;
  let mcgConfig = settingsDoc?.mcg ?? settingsDoc ?? null;
  if (!mcgConfig) {
    const settings = await Settings.findOne().select('mcg').lean();
    mcgConfig = settings?.mcg || null;
  }
  let disabled = false;
  if (mcgConfig) {
    if (resolvedGroup === undefined) {
      const parsed = Number(mcgConfig.group);
      if (Number.isFinite(parsed)) resolvedGroup = parsed;
    }
    if (mcgConfig.enabled === false) disabled = true;
  }

  if (disabled && !allowWhenDisabled) {
    return { skipped: true, reason: 'mcg_disabled' };
  }

  const res = await deleteMcgItems(payload, resolvedGroup);
  try {
    console.log('[mcg][delete] propagated product=%s identifiers=%d', productDoc?._id || 'n/a', payload.length);
  } catch {}
  return res;
}
