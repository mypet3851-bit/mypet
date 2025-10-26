// Get stock levels for a product (including per-size)
export const getProductStock = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const stockInfo = {
      productId: product._id,
      name: product.name,
      stock: product.stock,
      sizes: product.sizes?.map(size => ({ name: size.name, stock: size.stock })) || []
    };
    res.json(stockInfo);
  } catch (error) {
    console.error('Error fetching product stock:', error);
    res.status(500).json({ message: 'Failed to fetch product stock' });
  }
};

import Product from '../models/Product.js';
import Attribute from '../models/Attribute.js';
import AttributeValue from '../models/AttributeValue.js';
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import Warehouse from '../models/Warehouse.js';
import { validateProductData } from '../utils/validation.js';
import { handleProductImages } from '../utils/imageHandler.js';
import cloudinary from '../services/cloudinaryClient.js';
import { cacheGet, cacheSet } from '../utils/cache/simpleCache.js';
import { inventoryService } from '../services/inventoryService.js';
import { deepseekTranslate, deepseekTranslateBatch, isDeepseekConfigured } from '../services/translate/deepseek.js';
import { getItemQuantity as rivhitGetQty, testConnectivity as rivhitTest } from '../services/rivhitService.js';
// Currency conversion disabled for product storage/display; prices are stored and served as-is in store currency

// Get all products
// Shared query builder so both product listing and facet endpoints derive sizes/colors from actual filtered product set
async function resolveCategoryAndDescendants(categoryParam) {
  if (!categoryParam) return null;
  let catDoc = null;
  if (typeof categoryParam === 'string' && /^[a-fA-F0-9]{24}$/.test(categoryParam)) {
    catDoc = await Category.findById(categoryParam).select('_id');
  } else if (typeof categoryParam === 'string') {
    catDoc = await Category.findOne({ $or: [ { slug: categoryParam }, { name: new RegExp(`^${categoryParam}$`, 'i') } ] }).select('_id');
  }
  if (!catDoc) return { ids: null, notFound: true };
  const descendants = await Category.find({ $or: [ { _id: catDoc._id }, { ancestors: catDoc._id } ] }).select('_id');
  return { ids: descendants.map(d => d._id.toString()), notFound: false };
}

async function buildProductQuery(params) {
  const { search, category, categories, brand, isNew, isFeatured, onSale, includeInactive, colors, sizes, size, color, minPrice, maxPrice, primaryOnly, strictCategory, tag, tags } = params;
  let query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  if (category) {
    const resolved = await resolveCategoryAndDescendants(category);
    if (resolved?.notFound) {
      // Force empty query
      query.$and = [...(query.$and || []), { _id: { $in: [] } }];
    } else if (resolved?.ids && resolved.ids.length) {
      if (primaryOnly === 'true' || strictCategory === 'true') {
        query.$and = [...(query.$and || []), { category: { $in: resolved.ids } }];
      } else {
        query.$and = [...(query.$and || []), { $or: [ { category: { $in: resolved.ids } }, { categories: { $in: resolved.ids } } ] }];
      }
    }
  }
  if (categories) {
    const listRaw = String(categories).split(',').map(s => s.trim()).filter(Boolean);
    if (listRaw.length) {
      // Expand each to include descendants if possible (ignore notFound tokens silently)
      const allIds = new Set();
      for (const token of listRaw) {
        const resolved = await resolveCategoryAndDescendants(token);
        if (resolved?.ids?.length) {
          resolved.ids.forEach(id => allIds.add(id));
        } else if (!resolved?.notFound) {
          allIds.add(token); // fallback raw id
        }
      }
      const ids = Array.from(allIds);
      if (ids.length) {
        query.$and = [ ...(query.$and || []), { $or: [ { category: { $in: ids } }, { categories: { $in: ids } } ] } ];
      }
    }
  }
  if (isNew === 'true') query.isNew = true;
  if (isFeatured === 'true') query.isFeatured = true;
  if (onSale === 'true') query.$expr = { $gt: ["$originalPrice", "$price"] };

  if (minPrice != null || maxPrice != null) {
    const priceFilter = {};
    if (minPrice != null) priceFilter.$gte = Number(minPrice);
    if (maxPrice != null) priceFilter.$lte = Number(maxPrice);
    query.price = priceFilter;
  }

  const colorList = [color, ...(colors ? String(colors).split(',') : [])]
    .filter(Boolean).map(c => c.trim());
  if (colorList.length) query['colors.name'] = { $in: colorList };

  const sizeList = [size, ...(sizes ? String(sizes).split(',') : [])]
    .filter(Boolean).map(s => s.trim());
  if (sizeList.length) query['colors.sizes.name'] = { $in: sizeList };

  // Tags filter: ?tag=accessories or ?tags=a,b
  const tagList = [tag, ...(tags ? String(tags).split(',') : [])]
    .filter(Boolean)
    .map((t) => String(t).trim())
    .filter((t) => !!t);
  if (tagList.length) query.tags = { $in: tagList };

  if (!includeInactive || includeInactive === 'false') query.isActive = { $ne: false };
  if (brand) query.brand = brand;
  return query;
}

export const getProducts = async (req, res) => {
  try {
    const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    // Allow category to be provided as slug or name (not just ObjectId) just like filters endpoint.
    // Also: if a non-existent category slug/name is supplied, return an empty list instead of all products.
    let forceEmpty = false;
    const catParam = req.query.category;
    if (catParam && typeof catParam === 'string' && !/^[a-fA-F0-9]{24}$/.test(catParam)) {
      try {
        const catDoc = await Category.findOne({
          $or: [
            { slug: catParam },
            { name: new RegExp(`^${catParam}$`, 'i') }
          ]
        }).select('_id');
        if (catDoc) {
          req.query.category = catDoc._id.toString();
        } else {
          // Category slug/name not found – force empty result set (explicitly communicate)
          forceEmpty = true;
        }
      } catch (e) {
        // On lookup error, better to return empty than all products for an invalid category token
        forceEmpty = true;
      }
    }

    // Resolve brand by slug if provided via brandSlug param, or by name (fallback) via brandName
    if (!forceEmpty && (req.query.brand || req.query.brandSlug || req.query.brandName)) {
      try {
        if (req.query.brandSlug) {
          // Resolve brandSlug to ObjectId
          const b = await Brand.findOne({ slug: String(req.query.brandSlug).toLowerCase() }).select('_id');
          if (b) req.query.brand = b._id.toString(); else forceEmpty = true;
        } else if (req.query.brand && /^[a-fA-F0-9]{24}$/.test(String(req.query.brand))) {
          // already id; ok
        } else if (req.query.brandName) {
          const b = await Brand.findOne({ name: new RegExp(`^${String(req.query.brandName).trim()}$`, 'i') }).select('_id');
          if (b) req.query.brand = b._id.toString(); else forceEmpty = true;
        }
      } catch (_) {
        forceEmpty = true;
      }
    }

    if (forceEmpty) {
      return res.json([]);
    }
  const query = await buildProductQuery(req.query);
    // Optional pagination controls
    let limit = 0;
    let skip = 0;
    try {
      const ql = Number(req.query.limit);
      const qp = Number(req.query.page);
      if (Number.isFinite(ql) && ql > 0) {
        // Increase maximum page size for admin listing to 300 (was 60)
        limit = Math.min(Math.floor(ql), 300);
        if (Number.isFinite(qp) && qp > 1) {
          skip = (qp - 1) * limit;
        }
      }
    } catch {}

    let q = Product.find(query)
      .select('+colors.name +colors.code +colors.images +colors.sizes')
      // Populate primary & additional categories so client can show names
      .populate('category')
      .populate('categories')
  .populate('brand')
  .populate('attributes.attribute')
  .populate('attributes.values')
      .populate('relatedProducts')
      .populate({ path: 'reviews.user', select: 'name email image' })
      .sort({ isFeatured: -1, order: 1, createdAt: -1 });
    if (skip > 0) q = q.skip(skip);
    if (limit > 0) q = q.limit(limit);
    const products = await q;

  // Only auto-translate on demand to avoid slowing product listing with external API calls.
  // Enable by passing ?autoTranslate=true along with lang.
  const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const productsWithInventory = await Promise.all(
      products.map(async (product) => {
        const inventory = await Inventory.find({ product: product._id });
        const productObj = product.toObject();
        productObj.inventory = inventory;
        // Localize name/description if requested and available
        if (reqLang) {
          try {
            const nm = productObj.name_i18n?.get?.(reqLang) || (productObj.name_i18n && productObj.name_i18n[reqLang]);
            const desc = productObj.description_i18n?.get?.(reqLang) || (productObj.description_i18n && productObj.description_i18n[reqLang]);
            if (nm) productObj.name = nm;
            if (desc) productObj.description = desc;
            // Optionally auto-translate and persist when missing
            if ((!nm || !desc) && allowAutoTranslate) {
              const pDoc = await Product.findById(productObj._id);
              if (pDoc) {
                let changed = false;
                if (!nm && typeof pDoc.name === 'string' && pDoc.name.trim()) {
                  try {
                    const tr = await deepseekTranslate(pDoc.name, 'auto', reqLang);
                    const map = new Map(pDoc.name_i18n || []);
                    map.set(reqLang, tr);
                    pDoc.name_i18n = map;
                    productObj.name = tr;
                    changed = true;
                  } catch {}
                }
                if (!desc && typeof pDoc.description === 'string' && pDoc.description.trim()) {
                  try {
                    const trd = await deepseekTranslate(pDoc.description, 'auto', reqLang);
                    const mapd = new Map(pDoc.description_i18n || []);
                    mapd.set(reqLang, trd);
                    pDoc.description_i18n = mapd;
                    productObj.description = trd;
                    changed = true;
                  } catch {}
                }
                if (changed) { try { await pDoc.save(); } catch {} }
              }
            }
          } catch {}
        }
        return productObj;
      })
    );

    res.json(productsWithInventory);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

// Aggregate available filter facets from active products
export const getProductFilters = async (req, res) => {
  try {
    const start = Date.now();
    // Resolve category param (slug/name) to id for consistency
    const catParam = req.query.category;
    if (catParam && typeof catParam === 'string' && !/^[a-fA-F0-9]{24}$/.test(catParam)) {
      const catDoc = await Category.findOne({ $or: [ { slug: catParam }, { name: new RegExp(`^${catParam}$`, 'i') } ] }).select('_id');
      if (catDoc) req.query.category = catDoc._id.toString(); else delete req.query.category; // remove invalid
    }

    // Resolve brandSlug to id if provided
    let forceEmpty = false;
    if (req.query.brandSlug) {
      try {
        const b = await Brand.findOne({ slug: String(req.query.brandSlug).toLowerCase() }).select('_id');
        if (b) req.query.brand = b._id.toString(); else forceEmpty = true;
      } catch (_) {
        forceEmpty = true;
      }
    }

    if (forceEmpty) {
      return res.json({
        minPrice: 0,
        maxPrice: 0,
        priceBuckets: [],
        sizes: [],
        colors: [],
        colorObjects: [],
        categories: [],
        _ms: Date.now() - start
      });
    }

  const baseQuery = await buildProductQuery(req.query);

    // Build cache key (category + selected filters subset) - avoid including transient params like random query order
    const cacheKeyParts = [
      'pf',
      req.query.category || 'all',
      req.query.colors || '-',
      req.query.sizes || '-',
      req.query.minPrice || '-',
      req.query.maxPrice || '-'
    ];
    const cacheKey = cacheKeyParts.join('|');
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ ...cached, _cached: true, _ms: Date.now() - start });
    }

    // Pull min & max price fast (lean pipeline)
    const priceAgg = await Product.aggregate([
      { $match: baseQuery },
      { $group: { _id: null, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' } } }
    ]).allowDiskUse(false);
    const minPrice = priceAgg[0]?.minPrice ?? 0;
    const maxPrice = priceAgg[0]?.maxPrice ?? 0;

    // Distinct sets (returns primitives)
    const [primaryCats, secondaryCats, sizeNames, colorNames] = await Promise.all([
      Product.distinct('category', baseQuery),
      Product.distinct('categories', baseQuery),
      Product.distinct('colors.sizes.name', baseQuery),
      Product.distinct('colors.name', baseQuery)
    ]);

    // For color objects (name + code) we need a tiny aggregation because distinct can't combine fields
    const colorObjDocs = await Product.aggregate([
      { $match: baseQuery },
      { $unwind: { path: '$colors', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { name: '$colors.name', code: '$colors.code' } } }
    ]).allowDiskUse(false);
    const colorObjects = colorObjDocs
      .map(d => ({ name: d._id.name, code: d._id.code }))
      .filter(c => c.name);

    const catIds = [...new Set([...(primaryCats||[]), ...(secondaryCats||[])])].filter(Boolean);
  const categoryDocs = catIds.length ? await Category.find({ _id: { $in: catIds } }).select('name slug').lean() : [];

    // Normalize & dedupe (case-insensitive)
    const sizeOrder = ['XS','S','M','L','XL','XXL'];
    const seenSizesCI = new Map();
    (sizeNames||[]).forEach(s => { if (!s) return; const key = String(s).trim(); if (!key) return; const ci = key.toUpperCase(); if (!seenSizesCI.has(ci)) seenSizesCI.set(ci, key); });
    const sizes = Array.from(seenSizesCI.values()).sort((a,b)=>{
      const ai = sizeOrder.indexOf(a.toUpperCase()); const bi = sizeOrder.indexOf(b.toUpperCase());
      if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b);
    });
    const seenColorsCI = new Map();
    (colorNames||[]).forEach(c => { if (!c) return; const key = String(c).trim(); if (!key) return; const ci = key.toLowerCase(); if (!seenColorsCI.has(ci)) seenColorsCI.set(ci, key); });
    const colors = Array.from(seenColorsCI.values()).sort((a,b)=> a.localeCompare(b));
    const seenColorObjCI = new Set();
    const dedupColorObjects = colorObjects.filter(c=>{ if (!c || !c.name) return false; const nm = String(c.name).trim(); if (!nm) return false; const code = c.code ? String(c.code).trim() : undefined; const key = nm.toLowerCase()+'|'+(code||''); if (seenColorObjCI.has(key)) return false; seenColorObjCI.add(key); c.name = nm; if (code) c.code = code; return true; }).sort((a,b)=> a.name.localeCompare(b.name));

    // Adaptive price buckets
    let priceBuckets = [];
    if (minPrice !== null && maxPrice !== null && maxPrice > minPrice) {
      const span = maxPrice - minPrice;
      const step = span / 5;
      let start = minPrice;
      for (let i=0;i<5;i++) {
        let end = i===4 ? maxPrice : minPrice + step*(i+1);
        priceBuckets.push({ min: Number(start.toFixed(2)), max: Number(end.toFixed(2)) });
        start = end;
      }
    } else if (minPrice === maxPrice) {
      priceBuckets = [{ min: minPrice, max: maxPrice }];
    }
    // Collapse duplicate buckets (same min & max)
    const seenBuckets = new Set();
    priceBuckets = priceBuckets.filter(b => { const key = b.min+'|'+b.max; if (seenBuckets.has(key)) return false; seenBuckets.add(key); return true; });

    const payload = {
      minPrice,
      maxPrice,
      priceBuckets,
      sizes,
      colors,
      colorObjects: dedupColorObjects,
      categories: categoryDocs.map(c => ({ id: c._id, name: c.name, slug: c.slug })),
      _ms: Date.now() - start
    };
    // Cache for short TTL (e.g., 30s) to balance freshness vs speed
    cacheSet(cacheKey, payload, 30 * 1000);
    res.json(payload);
  } catch (err) {
    console.error('Error building product filters:', err);
    res.status(500).json({ message: 'Failed to build product filters' });
  }
};

// Get single product
export const getProduct = async (req, res) => {
  try {
  // Currency query param ignored; no conversion performed
    const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    
    const product = await Product.findById(req.params.id)
      .populate('category')
      .populate('categories')
      .populate('brand')
      .populate('attributes.attribute')
      .populate('attributes.values')
      // Ensure variant attribute/value documents are populated for UI labels
      .populate('variants.attributes.attribute')
      .populate('variants.attributes.value')
      .populate('relatedProducts')
      .populate('addOns')
      .populate({
        path: 'reviews.user',
        select: 'name email image'
      });
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Get inventory data
    const inventory = await Inventory.find({ product: product._id });
    const productObj = product.toObject();
    productObj.inventory = inventory;

    // Localize name/description if requested and available
    if (reqLang) {
      try {
        const nm = productObj.name_i18n?.get?.(reqLang) || (productObj.name_i18n && productObj.name_i18n[reqLang]);
        const desc = productObj.description_i18n?.get?.(reqLang) || (productObj.description_i18n && productObj.description_i18n[reqLang]);
        if (nm) productObj.name = nm;
        if (desc) productObj.description = desc;
    // Optionally auto-translate and persist when missing (opt-in via ?autoTranslate=true)
    const allowAutoTranslate = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    if ((!nm || !desc) && allowAutoTranslate) {
          let changed = false;
          if (!nm && typeof product.name === 'string' && product.name.trim()) {
            try {
              const tr = await deepseekTranslate(product.name, 'auto', reqLang);
              const map = new Map(product.name_i18n || []);
              map.set(reqLang, tr);
              product.name_i18n = map;
              productObj.name = tr;
              changed = true;
            } catch {}
          }
          if (!desc && typeof product.description === 'string' && product.description.trim()) {
            try {
              const trd = await deepseekTranslate(product.description, 'auto', reqLang);
              const mapd = new Map(product.description_i18n || []);
              mapd.set(reqLang, trd);
              product.description_i18n = mapd;
              productObj.description = trd;
              changed = true;
            } catch {}
          }
          if (changed) { try { await product.save(); } catch {} }
        }
      } catch {}
    }

    res.json(productObj);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: error.message });
  }
};

// Create product
export const createProduct = async (req, res) => {
  try {
    // NOTE: As of simplification, product creation supports a "simple mode" where
    // only name, description, price, images[], stock, category (+ optional videoUrls) are required.
    // Legacy variant creation with colors[]/sizes[] remains supported for backward compatibility.
    // Validate product data
    const { isValid, errors } = validateProductData(req.body);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid product data', errors });
    }

    // Normalize video URLs if provided (filter out empty strings)
    let videoUrls = Array.isArray(req.body.videoUrls) ? req.body.videoUrls.filter(v => typeof v === 'string' && v.trim()) : [];
    // Basic length cap to prevent abuse
    if (videoUrls.length > 8) videoUrls = videoUrls.slice(0, 8);

    // Optional sizeGuide normalization
    let sizeGuide = undefined;
    if (req.body.sizeGuide && typeof req.body.sizeGuide === 'object') {
      const sg = req.body.sizeGuide;
      const unit = ['cm', 'in'].includes(sg.unit) ? sg.unit : 'cm';
      const rows = Array.isArray(sg.rows) ? sg.rows.filter(r => r && r.size).map(r => ({
        size: String(r.size).trim(),
        chest: r.chest != null ? Number(r.chest) : undefined,
        waist: r.waist != null ? Number(r.waist) : undefined,
        hip: r.hip != null ? Number(r.hip) : undefined,
        length: r.length != null ? Number(r.length) : undefined,
        sleeve: r.sleeve != null ? Number(r.sleeve) : undefined
      })) : [];
      sizeGuide = {
        title: sg.title ? String(sg.title).trim() : undefined,
        unit,
        rows,
        note: sg.note ? String(sg.note).trim() : undefined
      };
    }

    // Multi-category: accept categories[] optionally, ensure primary category provided
    let categoriesArray = [];
    if (Array.isArray(req.body.categories)) {
      categoriesArray = req.body.categories.filter(c => c); // simple sanitize
    }
    const simpleMode = !Array.isArray(req.body.colors) || req.body.colors.length === 0;

    // Normalize attributes if provided (accept ids or populated objects)
    const normalizeAttributes = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((a) => {
          if (!a) return null;
          let attribute = null;
          if (typeof a.attribute === 'string' && /^[a-fA-F0-9]{24}$/.test(a.attribute)) {
            attribute = a.attribute;
          } else if (a.attribute && typeof a.attribute === 'object' && typeof a.attribute._id === 'string' && /^[a-fA-F0-9]{24}$/.test(a.attribute._id)) {
            attribute = a.attribute._id;
          }
          if (!attribute) return null;
          const values = Array.isArray(a.values)
            ? a.values
                .map((v) => (typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v) ? v : (v && typeof v === 'object' && typeof v._id === 'string' && /^[a-fA-F0-9]{24}$/.test(v._id) ? v._id : null)))
                .filter(Boolean)
            : [];
          const textValue = typeof a.textValue === 'string' ? a.textValue.trim() : undefined;
          const numberValue = a.numberValue != null && !Number.isNaN(Number(a.numberValue)) ? Number(a.numberValue) : undefined;
          return { attribute, values, textValue, numberValue };
        })
        .filter(Boolean);
    };

    // Normalize tags (allow array or comma-separated string)
    let tags = [];
    try {
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
      } else if (typeof req.body.tags === 'string') {
        tags = req.body.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
      }
    } catch {}

    const baseDoc = {
      name: req.body.name,
      description: req.body.description,
      price: req.body.price,
      originalPrice: req.body.originalPrice,
      images: req.body.images,
      stock: req.body.stock,
      category: req.body.category,
      categories: categoriesArray,
      // optional brand
      brand: req.body.brand || undefined,
      // optional Rivhit mapping on create
      rivhitItemId: Number.isFinite(Number(req.body.rivhitItemId)) ? Number(req.body.rivhitItemId) : undefined,
      isNew: !!req.body.isNew,
      isFeatured: !!req.body.isFeatured,
      sizeGuide,
      videoUrls,
      order: req.body.isFeatured ? await Product.countDocuments({ isFeatured: true }) : 0,
      attributes: normalizeAttributes(req.body.attributes),
      tags
    };

    if (!simpleMode) {
      baseDoc.colors = req.body.colors; // legacy path
    }

    // If brand provided as string name, try resolving to Brand _id; if 24-hex assume ObjectId; otherwise ignore
    if (baseDoc.brand) {
      const bVal = baseDoc.brand;
      const isObjectId = typeof bVal === 'string' && /^[a-fA-F0-9]{24}$/.test(bVal);
      if (!isObjectId) {
        const bDoc = await Brand.findOne({ name: new RegExp(`^${String(bVal).trim()}$`, 'i') }).select('_id');
        baseDoc.brand = bDoc?._id || undefined;
      }
    }

    const product = new Product(baseDoc);
  let savedProduct = await product.save();
  // Populate categories before responding so client gets names immediately
  savedProduct = await savedProduct.populate(['category','categories','brand']);


    // Find or create a default warehouse
    let warehouse = await Warehouse.findOne();
    if (!warehouse) {
      warehouse = await Warehouse.create({ name: 'Main Warehouse' });
    }

    if (!simpleMode) {
      // Legacy variant inventory creation
      let totalQty = 0;
      const inventoryPromises = (req.body.colors || []).flatMap(color =>
        (color.sizes || []).map(size => {
          totalQty += Number(size.stock) || 0;
          return new Inventory({
            product: savedProduct._id,
            size: size.name,
            color: color.name,
            quantity: size.stock,
            warehouse: warehouse._id,
            location: warehouse.name,
            lowStockThreshold: 5
          }).save();
        })
      );
      await Promise.all(inventoryPromises);

      await new InventoryHistory({
        product: savedProduct._id,
        type: 'increase',
        quantity: totalQty,
        reason: 'Initial stock',
        user: req.user?._id
      }).save();
    } else {
      // Simple mode: single inventory record representing total stock (use placeholder variant)
      const baseQty = Number(req.body.stock) || 0;
      await new Inventory({
        product: savedProduct._id,
        size: 'Default',
        color: 'Default',
        quantity: baseQty,
        warehouse: warehouse._id,
        location: warehouse.name,
        lowStockThreshold: 5
      }).save();
      await new InventoryHistory({
        product: savedProduct._id,
        type: 'increase',
        quantity: baseQty,
        reason: 'Initial stock (simple mode)',
        user: req.user?._id
      }).save();
    }

  res.status(201).json(savedProduct);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(400).json({ message: error.message });
  }
};

// Admin: Sync quantity from Rivhit for a product (simple product) or specific variant
export const syncQuantityFromRivhit = async (req, res) => {
  try {
    const { id } = req.params; // product id
    const { variantId } = req.query; // optional
    // Preflight: ensure Rivhit is enabled and token exists before attempting remote call
    try {
      const pre = await rivhitTest();
      if (!pre?.ok) {
        return res.status(412).json({ message: 'Rivhit not ready', reason: pre?.reason || 'unknown' });
      }
    } catch {}
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    let itemId = null;
    // Admin override: allow specifying id_item directly for quick tests or ad-hoc syncs
    try {
      const overrideRaw = (req.body && (req.body.id_item ?? req.body.itemId)) ?? (req.query && (req.query.id_item ?? req.query.itemId));
      const override = Number(overrideRaw);
      if (Number.isFinite(override) && override > 0) {
        itemId = override;
      }
    } catch {}
    if (variantId) {
      const v = (product.variants || []).id(variantId);
      if (!v) return res.status(404).json({ message: 'Variant not found' });
      if (!itemId) itemId = v?.rivhitItemId || null;
    } else {
      if (!itemId) itemId = product.rivhitItemId || null;
    }
    if (!itemId) return res.status(400).json({ message: 'No Rivhit item id mapped for the selected entity' });
    // Optional per-warehouse quantity: allow admin to provide storage_id via query/body override
    let storageOverrideRaw = undefined;
    try {
      storageOverrideRaw = (req.body && (req.body.storage_id ?? req.body.storageId)) ?? (req.query && (req.query.storage_id ?? req.query.storageId));
    } catch {}
    const storage_id = Number(storageOverrideRaw);
    const payload = Number.isFinite(storage_id) && storage_id > 0
      ? { id_item: Number(itemId), storage_id }
      : { id_item: Number(itemId) };
    const { quantity } = await rivhitGetQty(payload);
    // Apply to inventory: set the main/default warehouse row to the fetched quantity
    let warehouses = await Warehouse.find({});
    if (!warehouses || warehouses.length === 0) {
      const created = await Warehouse.findOneAndUpdate({ name: 'Main Warehouse' }, { $setOnInsert: { name: 'Main Warehouse' } }, { upsert: true, new: true });
      warehouses = created ? [created] : [];
    }
    if (!warehouses || warehouses.length === 0) return res.status(500).json({ message: 'No warehouses available' });
    const main = warehouses.find(w => String(w.name).toLowerCase() === 'main warehouse') || warehouses[0];
    const filter = variantId ? { product: id, variantId, warehouse: main._id } : { product: id, size: 'Default', color: 'Default', warehouse: main._id };
    const update = { $set: { quantity: Math.max(0, Number(quantity) || 0) } };
    await Inventory.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    try { await inventoryService.recomputeProductStock(id); } catch {}
    res.json({ synced: true, quantity, id_item: Number(itemId), storage_id: (Number.isFinite(storage_id) && storage_id > 0) ? storage_id : undefined });
  } catch (e) {
    console.error('syncQuantityFromRivhit error', e);
    const status = e?.code === 412 ? 412 : 400;
    res.status(status).json({ message: e?.message || 'Failed to sync quantity', code: e?.code || 0 });
  }
};

// Update product
export const updateProduct = async (req, res) => {
  try {
  const { sizes, colors: incomingColors, videoUrls: incomingVideoUrls, sizeGuide: incomingSizeGuide, categories: incomingCategories, isActive: incomingIsActive, slug: incomingSlug, metaTitle, metaDescription, metaKeywords, ogTitle, ogDescription, ogImage, brand: incomingBrand, rivhitItemId: incomingRivhitItemId, tags: incomingTags, ...updateData } = req.body;
    // Start with shallow copy of remaining fields
    const updateDataSanitized = { ...updateData };
    // Normalize attributes array if provided
    if (updateData.attributes !== undefined) {
      const norm = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr
          .map((a) => {
            if (!a) return null;
            let attribute = null;
            if (typeof a.attribute === 'string' && /^[a-fA-F0-9]{24}$/.test(a.attribute)) {
              attribute = a.attribute;
            } else if (a.attribute && typeof a.attribute === 'object' && typeof a.attribute._id === 'string' && /^[a-fA-F0-9]{24}$/.test(a.attribute._id)) {
              attribute = a.attribute._id;
            }
            if (!attribute) return null;
            const values = Array.isArray(a.values)
              ? a.values
                  .map((v) => (typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v) ? v : (v && typeof v === 'object' && typeof v._id === 'string' && /^[a-fA-F0-9]{24}$/.test(v._id) ? v._id : null)))
                  .filter(Boolean)
              : [];
            const textValue = typeof a.textValue === 'string' ? a.textValue.trim() : undefined;
            const numberValue = a.numberValue != null && !Number.isNaN(Number(a.numberValue)) ? Number(a.numberValue) : undefined;
            return { attribute, values, textValue, numberValue };
          })
          .filter(Boolean);
      };
      updateDataSanitized.attributes = norm(updateData.attributes);
    }

    // Assign meta / slug fields after declaration
    if (incomingSlug !== undefined) {
      updateDataSanitized.slug = String(incomingSlug).trim() || undefined;
    }
    if (metaTitle !== undefined) updateDataSanitized.metaTitle = metaTitle;
    if (metaDescription !== undefined) updateDataSanitized.metaDescription = metaDescription;
    if (metaKeywords !== undefined) {
      if (Array.isArray(metaKeywords)) {
        updateDataSanitized.metaKeywords = metaKeywords.map(k => String(k).trim()).filter(Boolean);
      } else if (typeof metaKeywords === 'string') {
        updateDataSanitized.metaKeywords = metaKeywords.split(',').map(k => k.trim()).filter(Boolean);
      }
    }
    // Normalize tags if provided (array or comma-separated string)
    if (incomingTags !== undefined) {
      if (Array.isArray(incomingTags)) {
        updateDataSanitized.tags = incomingTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
      } else if (typeof incomingTags === 'string') {
        updateDataSanitized.tags = incomingTags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
      } else if (incomingTags === null) {
        updateDataSanitized.tags = [];
      }
    }
    if (ogTitle !== undefined) updateDataSanitized.ogTitle = ogTitle;
    if (ogDescription !== undefined) updateDataSanitized.ogDescription = ogDescription;
    if (ogImage !== undefined) updateDataSanitized.ogImage = ogImage;

    // Handle categories array update if provided
    if (incomingCategories !== undefined) {
      if (!Array.isArray(incomingCategories)) {
        return res.status(400).json({ message: 'categories must be an array' });
      }
      updateDataSanitized.categories = incomingCategories.filter(c => c);
    }

    // Handle optional brand update
    if (incomingBrand !== undefined) {
      if (incomingBrand === null || incomingBrand === '' ) {
        updateDataSanitized.brand = undefined; // unset
      } else {
        const bVal = incomingBrand;
        const isObjectId = typeof bVal === 'string' && /^[a-fA-F0-9]{24}$/.test(bVal);
        if (isObjectId) {
          updateDataSanitized.brand = bVal;
        } else {
          const bDoc = await Brand.findOne({ name: new RegExp(`^${String(bVal).trim()}$`, 'i') }).select('_id');
          if (bDoc) updateDataSanitized.brand = bDoc._id;
          else updateDataSanitized.brand = undefined; // ignore if not resolvable
        }
      }
    }

    // Handle isActive flag
    if (incomingIsActive !== undefined) {
      updateDataSanitized.isActive = !!incomingIsActive;
    }

    if (incomingRivhitItemId !== undefined) {
      const n = Number(incomingRivhitItemId);
      updateDataSanitized.rivhitItemId = Number.isFinite(n) && n > 0 ? n : undefined;
    }

    if (incomingVideoUrls !== undefined) {
      if (!Array.isArray(incomingVideoUrls)) {
        return res.status(400).json({ message: 'videoUrls must be an array of strings' });
      }
      const cleaned = incomingVideoUrls
        .filter(v => typeof v === 'string' && v.trim())
        .slice(0, 8); // enforce max 8
      updateDataSanitized.videoUrls = cleaned;
    }

    // Coerce numeric fields if provided as strings
    if (updateDataSanitized.price != null) {
      const n = Number(updateDataSanitized.price);
      if (Number.isNaN(n) || n < 0) {
        return res.status(400).json({ message: 'Invalid price value' });
      }
      updateDataSanitized.price = n;
    }

    if (updateDataSanitized.originalPrice !== undefined) {
      if (updateDataSanitized.originalPrice === '' || updateDataSanitized.originalPrice === null) {
        // If empty string/null provided, unset originalPrice
        delete updateDataSanitized.originalPrice;
      } else {
        const on = Number(updateDataSanitized.originalPrice);
        if (Number.isNaN(on) || on < 0) {
          return res.status(400).json({ message: 'Invalid originalPrice value' });
        }
        updateDataSanitized.originalPrice = on;
      }
    }

    // Accept category as either ObjectId or case-insensitive name
    if (updateDataSanitized.category) {
      const catVal = updateDataSanitized.category;
      const isObjectId = typeof catVal === 'string' && /^[a-fA-F0-9]{24}$/.test(catVal);
      if (!isObjectId) {
        const cat = await Category.findOne({ name: new RegExp(`^${String(catVal).trim()}$`, 'i') });
        if (!cat) {
          return res.status(400).json({ message: `Category not found: ${catVal}` });
        }
        updateDataSanitized.category = cat._id;
      }
    }

    // Normalize sizeGuide if provided
    if (incomingSizeGuide !== undefined) {
      if (incomingSizeGuide && typeof incomingSizeGuide === 'object') {
        const sg = incomingSizeGuide;
        const unit = ['cm', 'in'].includes(sg.unit) ? sg.unit : 'cm';
        const rows = Array.isArray(sg.rows) ? sg.rows.filter(r => r && r.size).map(r => ({
          size: String(r.size).trim(),
          chest: r.chest != null ? Number(r.chest) : undefined,
          waist: r.waist != null ? Number(r.waist) : undefined,
          hip: r.hip != null ? Number(r.hip) : undefined,
          length: r.length != null ? Number(r.length) : undefined,
          sleeve: r.sleeve != null ? Number(r.sleeve) : undefined
        })) : [];
        updateDataSanitized.sizeGuide = {
          title: sg.title ? String(sg.title).trim() : undefined,
          unit,
          rows,
            note: sg.note ? String(sg.note).trim() : undefined
        };
      } else if (incomingSizeGuide === null) {
        // Allow clearing sizeGuide
        updateDataSanitized.sizeGuide = undefined;
      }
    }

    // If colors provided, sanitize & attach (including nested images & sizes)
    if (incomingColors !== undefined) {
      if (!Array.isArray(incomingColors)) {
        return res.status(400).json({ message: 'colors must be an array' });
      }
      const cleanedColors = incomingColors.map(c => {
        if (!c || typeof c !== 'object') return null;
        const name = c.name ? String(c.name).trim() : '';
        const code = c.code ? String(c.code).trim() : '';
        if (!name || !code) return null;
        const images = Array.isArray(c.images) ? c.images.filter(i => typeof i === 'string' && i.trim()).map(i => i.trim()).slice(0,5) : [];
        const sizesArr = Array.isArray(c.sizes)
          ? c.sizes.filter(s => s && s.name).map(s => ({
              name: String(s.name).trim(),
              stock: Number.isFinite(Number(s.stock)) && Number(s.stock) >= 0 ? Number(s.stock) : 0
            })).slice(0,50)
          : [];
        return { name, code, images, sizes: sizesArr };
      }).filter(Boolean);
      updateDataSanitized.colors = cleanedColors;

      // Derive total stock from color sizes if not explicitly provided
      if ((!updateDataSanitized.stock || updateDataSanitized.stock === 0) && cleanedColors.length) {
        const total = cleanedColors.reduce((sum, col) => sum + col.sizes.reduce((s, sz) => s + (sz.stock || 0), 0), 0);
        updateDataSanitized.stock = total;
      }
    }

    // Update product document with sanitized data
    const productBefore = await Product.findById(req.params.id).lean();
    let product = await Product.findByIdAndUpdate(
      req.params.id,
      updateDataSanitized,
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Update inventory if sizes or colors changed (legacy path; prefer color-level sizes now)
    if (Array.isArray(sizes) && Array.isArray(incomingColors)) {
      // Get current inventory
      const currentInventory = await Inventory.find({ product: product._id });

      // Create new inventory records for new size/color combinations
      const newCombinations = sizes.flatMap(size =>
        incomingColors.map(color => ({
          size: size.name,
          color: color.name,
          stock: Number(size.stock) || 0
        }))
      );

      // Update or create inventory records
      await Promise.all(
        newCombinations.map(async ({ size, color, stock }) => {
          const existing = currentInventory.find(inv => 
            inv.size === size && inv.color === color
          );

          if (existing) {
            const oldQuantity = existing.quantity;
            existing.quantity = stock;
            await existing.save();

            // Create history record for quantity change
            if (oldQuantity !== stock) {
              await new InventoryHistory({
                product: product._id,
                type: stock > oldQuantity ? 'increase' : 'decrease',
                quantity: Math.abs(stock - oldQuantity),
                reason: 'Stock update',
                user: req.user?._id
              }).save();
            }
          } else {
            const newInventory = await new Inventory({
              product: product._id,
              size,
              color,
              quantity: stock,
              location: 'Main Warehouse',
              lowStockThreshold: 5
            }).save();

            // Create history record for new inventory
            await new InventoryHistory({
              product: product._id,
              type: 'increase',
              quantity: stock,
              reason: 'New size/color added',
              user: req.user?._id
            }).save();
          }
        })
      );
    }

    // If only color images changed (and no top-level images updated) we can bump imagesVersion for cache busting
    try {
      if (incomingColors !== undefined && productBefore) {
        const beforeColorImages = (productBefore.colors || []).flatMap(c => c.images || []);
        const afterColorImages = (product.colors || []).flatMap(c => c.images || []);
        const changed = beforeColorImages.length !== afterColorImages.length || beforeColorImages.some((img, idx) => img !== afterColorImages[idx]);
        if (changed && (!updateDataSanitized.images || updateDataSanitized.images.length === 0)) {
            // bump imagesVersion to force clients to refresh derived images
            if (typeof product.imagesVersion !== 'number') {
              product.imagesVersion = 1;
            } else {
              product.imagesVersion += 1;
            }
            await product.save();
        }
      }
    } catch (e) { /* silent */ }

  product = await product.populate(['category','categories','brand','attributes.attribute','attributes.values']);
  res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(400).json({ message: error.message });
  }
};

// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const { hard } = req.query;
    if (hard === 'true') {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ message: 'Product not found' });
      await Inventory.deleteMany({ product: product._id });
      await new InventoryHistory({
        product: product._id,
        type: 'decrease',
        quantity: product.stock,
        reason: 'Product hard deleted',
        user: req.user._id
      }).save();
      return res.json({ message: 'Product hard deleted' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    // Remove inventory rows so the product disappears from Inventory page
    try { await Inventory.deleteMany({ product: product._id }); } catch (e) { try { console.warn('[products][delete] inventory cleanup failed', e?.message || e); } catch {} }
    // Recompute stock to reflect deletion (will become 0 with no rows)
    try { await inventoryService.recomputeProductStock(product._id); } catch {}
    await new InventoryHistory({
      product: product._id,
      type: 'decrease',
      quantity: 0,
      reason: 'Product soft deactivated',
      user: req.user._id
    }).save();
    res.json({ message: 'Product deactivated (soft delete)', product });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: error.message });
  }
};

// Search products
export const searchProducts = async (req, res) => {
  try {
    let { query } = req.query;
    const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';

    // Basic sanitization
    if (typeof query !== 'string') query = '';
    query = query.trim();

    if (!query) {
      return res.json([]);
    }

    // Prevent excessively long regex causing performance issues
    if (query.length > 64) {
      query = query.slice(0, 64);
    }

    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Attempt to match categories by name first (case-insensitive exact or partial)
    let categoryIds = [];
    try {
      const catMatches = await Category.find({ name: regex }).select('_id');
      categoryIds = catMatches.map(c => c._id);
    } catch (e) {
      console.warn('Category lookup failed during search:', e.message);
    }

    // Build $or conditions only for valid fields
    const orConditions = [
      { name: regex },
      { description: regex }
    ];
    if (categoryIds.length) {
      orConditions.push({ category: { $in: categoryIds } });
      orConditions.push({ categories: { $in: categoryIds } });
    }

    const products = await Product.find({ $or: orConditions, isActive: { $ne: false } })
      // Include i18n maps so we can localize name in results when lang is provided
      .select('name name_i18n price images category colors')
      .limit(12)
      .sort('-createdAt')
      .lean();
    if (process.env.NODE_ENV !== 'production') {
      console.log(`searchProducts query="${query}" matches=${products.length} categoriesMatched=${categoryIds.length}`);
    }
    // Localize name if requested and available (do NOT auto-translate here to keep search fast)
    if (reqLang) {
      try {
        for (const p of products) {
          const nm = (p?.name_i18n && (typeof p.name_i18n.get === 'function' ? p.name_i18n.get(reqLang) : p.name_i18n[reqLang])) || '';
          if (nm) p.name = nm;
          // strip i18n maps from response to keep payload minimal
          if (p.name_i18n) delete p.name_i18n;
        }
      } catch {}
    }
    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ message: 'Failed to search products' });
  }
};

// Lightweight product by id (name, price, images) for admin selectors
export const getProductLite = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    const prod = await Product.findById(id).select('name name_i18n price images').lean();
    if (!prod) return res.status(404).json({ message: 'Product not found' });
    if (reqLang) {
      try {
        const nm = (prod?.name_i18n && (typeof (prod.name_i18n).get === 'function' ? (prod.name_i18n).get(reqLang) : (prod.name_i18n)[reqLang])) || '';
        if (nm) prod.name = nm;
        // Strip i18n map from the lite response; avoid TS-style assertions in JS runtime
        if (prod.name_i18n) delete prod.name_i18n;
      } catch {}
    }
    res.json(prod);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load product' });
  }
};

// Update only product images (partial update)
export const updateProductImages = async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images)) {
      return res.status(400).json({ message: 'images must be an array of strings' });
    }
    // Basic sanitization & limit
    const cleaned = images
      .filter(i => typeof i === 'string')
      .map(i => i.trim())
      .filter(Boolean)
      .slice(0, 24); // hard cap to prevent abuse

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    product.images = cleaned;
    // Maintain or initialize an imagesVersion field (used for cache busting client side)
    if (typeof product.imagesVersion !== 'number') {
      product.imagesVersion = 1;
    } else {
      product.imagesVersion += 1;
    }
    await product.save();
    res.json({ message: 'Images updated', images: product.images, imagesVersion: product.imagesVersion });
  } catch (error) {
    console.error('Error updating product images:', error);
    res.status(500).json({ message: 'Failed to update product images' });
  }
};

// Update related products
export const updateRelatedProducts = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { relatedProducts: req.body.relatedProducts },
      { new: true }
    ).populate('relatedProducts');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Error updating related products:', error);
    res.status(400).json({ message: error.message });
  }
};

// Update product add-ons (upsell items)
export const updateAddOns = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { addOns: req.body.addOns },
      { new: true }
    ).populate('addOns');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error updating product add-ons:', error);
    res.status(400).json({ message: error.message });
  }
};

// Upload a single video and append its URL to product.videoUrls
export const uploadProductVideo = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    if (!req.file) return res.status(400).json({ message: 'No video file provided' });

    // Limit number of videos
    if (product.videoUrls && product.videoUrls.length >= 8) {
      return res.status(400).json({ message: 'Maximum of 8 videos reached' });
    }

    // Cloudinary upload via upload_stream using buffer
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: 'video',
        folder: 'products/videos'
      }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(req.file.buffer);
    });

    const url = uploadResult.secure_url;
    product.videoUrls = product.videoUrls || [];
    product.videoUrls.push(url);
    await product.save();

    res.status(201).json({ url, videoUrls: product.videoUrls });
  } catch (error) {
    console.error('Error uploading product video:', error);
    res.status(500).json({ message: 'Failed to upload video', error: error.message });
  }
};

// Standalone video upload (for use before product exists). Returns Cloudinary URL so client can include it in createProduct videoUrls.
export const uploadTempProductVideo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No video file provided' });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: 'video',
        folder: 'products/videos'
      }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(req.file.buffer);
    });

    res.status(201).json({ url: uploadResult.secure_url });
  } catch (error) {
    console.error('Error uploading temporary product video:', error);
    res.status(500).json({ message: 'Failed to upload video', error: error.message });
  }
};

// Reorder featured products
export const reorderFeaturedProducts = async (req, res) => {
  try {
    const { products } = req.body;
    await Promise.all(
      products.map(({ id, order }) => 
        Product.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Featured products reordered successfully' });
  } catch (error) {
    console.error('Error reordering featured products:', error);
    res.status(500).json({ message: 'Failed to reorder featured products' });
  }
};

// Generate variants from product.attributes by computing cartesian product of selected attribute values
export const generateProductVariants = async (req, res) => {
  try {
  const productId = req.params.id;
  const product = await Product.findById(productId).populate('attributes.attribute').populate('attributes.values');
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Build options list: for each attribute, determine set of values (value ids or text/number)
    const dimensions = [];
    for (const pa of (product.attributes || [])) {
      const attr = pa.attribute;
      if (!attr) continue;
      const type = (attr && attr.type) || 'select';
      if (['text','number'].includes(type)) {
        // Skip freeform attributes in cartesian generation (or one choice if provided)
        const single = type === 'text' ? (pa.textValue ? [{ textValue: pa.textValue }] : []) : (pa.numberValue != null ? [{ numberValue: pa.numberValue }] : []);
        if (single.length) dimensions.push({ attribute: attr._id, choices: single });
      } else {
        const values = Array.isArray(pa.values) ? pa.values.map((v) => ({ value: ((v && v._id) || v) })) : [];
        if (values.length) dimensions.push({ attribute: attr._id, choices: values });
      }
    }

    if (!dimensions.length) {
      return res.status(400).json({ message: 'No attributes with values to generate variants from' });
    }

    // Cartesian product
    const combos = [];
    const backtrack = (idx, acc) => {
      if (idx === dimensions.length) { combos.push(acc.slice()); return; }
      for (const choice of dimensions[idx].choices) {
        acc.push({ attribute: dimensions[idx].attribute, ...choice });
        backtrack(idx + 1, acc);
        acc.pop();
      }
    };
    backtrack(0, []);

    // Build variant documents; preserve existing variants (match by attribute set)
    const existing = Array.isArray(product.variants) ? product.variants : [];
    const serializeKey = (attrs) => attrs
      .map(a => `${a.attribute}:${a.value || a.textValue || a.numberValue}`)
      .sort()
      .join('|');
    const existingMap = new Map(existing.map(v => [serializeKey(((v || {}).attributes)||[]), v]));

    // Helper: find images for an attribute value (e.g., Color=Red) from attributeImages
    const findImagesForCombo = (combo) => {
      const imgs = [];
      const ai = Array.isArray(product.attributeImages) ? product.attributeImages : [];
      for (const c of combo) {
        if (c.value) {
          const match = ai.find(x => String(x.attribute) === String(c.attribute) && String(x.value) === String(c.value));
          if (match && Array.isArray(match.images)) {
            for (const m of match.images) { if (typeof m === 'string') imgs.push(m); }
          }
        }
      }
      // dedupe
      const seen = new Set();
      return imgs.filter(u => { if (!u || seen.has(u)) return false; seen.add(u); return true; });
    };

    const nextVariants = combos.map((combo) => {
      const key = serializeKey(combo);
      const prev = existingMap.get(key);
      if (prev) return prev; // keep existing data (price/sku/stock/images)
      return {
        sku: undefined,
        barcode: undefined,
        price: undefined,
        originalPrice: undefined,
        stock: 0,
        images: findImagesForCombo(combo),
        isActive: true,
        attributes: combo
      };
    });

    product.variants = nextVariants;
    await product.save();
    // Optional: ensure each variant has initial inventory rows (0 qty) in all warehouses
    try {
      let warehouses = await Warehouse.find({});
      if (!warehouses || warehouses.length === 0) {
        // Ensure at least one default warehouse exists
        try {
          const created = await Warehouse.findOneAndUpdate(
            { name: 'Main Warehouse' },
            { $setOnInsert: { name: 'Main Warehouse' } },
            { new: true, upsert: true }
          );
          warehouses = created ? [created] : [];
        } catch (err) {
          const existing = await Warehouse.find({});
          warehouses = existing;
        }
      }
      if (warehouses && warehouses.length) {
        // Create missing rows only across all warehouses with zero quantity
        const fresh = await Product.findById(productId).select('variants');
        for (const v of fresh?.variants || []) {
          for (const w of warehouses) {
            const exists = await Inventory.exists({ product: productId, variantId: v._id, warehouse: w._id });
            if (!exists) {
              try {
                await new Inventory({
                  product: productId,
                  variantId: v._id,
                  quantity: 0,
                  warehouse: w._id,
                  location: w.name,
                  lowStockThreshold: 5,
                  attributesSnapshot: Array.isArray(v.attributes) ? v.attributes : undefined
                }).save();
              } catch (err) {
                // Ignore duplicate key errors due to race conditions
                if (!(err && (err.code === 11000))) throw err;
              }
            }
          }
        }
        // Recompute aggregates after ensuring inventory rows
        try { await inventoryService.recomputeProductStock(productId); } catch {}
      }
    } catch (e) {
      console.warn('generateProductVariants: ensure initial inventory rows skipped due to error', e?.message || e);
    }
    const populated = await Product.findById(productId)
      .populate('variants.attributes.attribute')
      .populate('variants.attributes.value');
    res.json(populated?.variants || []);
  } catch (e) {
    console.error('generateProductVariants error', e);
    res.status(500).json({ message: 'Failed to generate variants' });
  }
};

// Update one variant (price, sku, stock, images, isActive)
export const updateVariant = async (req, res) => {
  try {
  const { id, variantId } = req.params;
  const { sku, barcode, price, originalPrice, stock, images, isActive, rivhitItemId } = req.body || {};
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const v = (product.variants || []).id(variantId);
    if (!v) return res.status(404).json({ message: 'Variant not found' });
    if (sku !== undefined) v.sku = sku;
    if (barcode !== undefined) v.barcode = barcode;
    if (price !== undefined) v.price = Number(price);
    if (originalPrice !== undefined) v.originalPrice = Number(originalPrice);
    if (rivhitItemId !== undefined) {
      const n = Number(rivhitItemId);
      v.rivhitItemId = Number.isFinite(n) && n > 0 ? n : undefined;
    }
    // Stock handling: prefer inventory as source of truth. If no inventory exists yet for this variant,
    // allow setting stock here by creating an initial record in a default warehouse.
    let createdInitialInventory = false;
    if (stock !== undefined) {
      const invExists = await Inventory.exists({ product: id, variantId });
      const desired = Math.max(0, Number(stock));
      if (!invExists) {
        // Ensure inventory rows exist for all warehouses; assign desired qty to default (or first) warehouse, others zero
        let warehouses = await Warehouse.find({});
        if (!warehouses || warehouses.length === 0) {
          try {
            const createdWh = await Warehouse.findOneAndUpdate(
              { name: 'Main Warehouse' },
              { $setOnInsert: { name: 'Main Warehouse' } },
              { new: true, upsert: true }
            );
            warehouses = createdWh ? [createdWh] : [];
          } catch (e) {
            warehouses = await Warehouse.find({});
          }
        }
        if (!warehouses || warehouses.length === 0) {
          console.error('updateVariant: no warehouses available to create initial inventory');
          return res.status(500).json({ message: 'No warehouses available to create initial inventory' });
        }
        const main = warehouses.find(w => String(w.name).toLowerCase() === 'main warehouse') || warehouses[0];
        for (const w of warehouses) {
          const qty = String(w._id) === String(main._id) ? desired : 0;
          const exists = await Inventory.exists({ product: id, variantId, warehouse: w._id });
          if (!exists) {
            try {
              await new Inventory({
                product: id,
                variantId,
                quantity: qty,
                warehouse: w._id,
                location: w.name,
                lowStockThreshold: 5
              }).save();
            } catch (err) {
              // Ignore duplicate key errors; a concurrent creator may have inserted it
              if (!(err && (err.code === 11000))) throw err;
            }
          } else if (qty > 0) {
            // If a row exists for the main warehouse, ensure it reflects the desired quantity
            await Inventory.findOneAndUpdate({ product: id, variantId, warehouse: w._id }, { quantity: qty }, { new: true });
          }
        }
        createdInitialInventory = true;
        // v.stock will be recomputed from inventory by hooks/service; set for immediate response UX
        v.stock = desired;
        // Keep product and variant aggregates in sync immediately
        try { await inventoryService.recomputeProductStock(id); } catch {}
      } else {
        // If inventory already exists across warehouses, require dedicated inventory endpoints
        return res.status(409).json({
          message: 'Variant already has warehouse inventory. Use inventory endpoints to update quantities per warehouse.'
        });
      }
    }
    if (Array.isArray(images)) v.images = images.filter((i)=> typeof i === 'string' && i.trim());
    if (isActive !== undefined) v.isActive = !!isActive;
    await product.save();
    const populated = await Product.findById(id).select('variants').populate('variants.attributes.attribute').populate('variants.attributes.value');
    const updated = (populated && populated.variants ? populated.variants.find((x)=> x._id.toString()===variantId) : null);
    res.json(updated);
  } catch (e) {
    console.error('updateVariant error', e);
    res.status(500).json({ message: 'Failed to update variant' });
  }
};

// Bulk update variants (e.g., price/stock add/subtract/set)
export const bulkUpdateVariants = async (req, res) => {
  try {
  const { id } = req.params;
    const { selection, operation } = req.body || {};
    // selection: array of variantIds; if omitted or empty -> apply to all
    // operation: { field: 'price'|'stock'|'isActive', mode: 'set'|'add'|'sub', value }
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
  const ids = (Array.isArray(selection) && selection.length) ? selection.map(String) : (product.variants||[]).map((v)=> String(v._id));
    const { field, mode, value } = operation || {};
    for (const v of (product.variants || [])) {
      if (!ids.includes(String(v._id))) continue;
      if (field === 'isActive') { v.isActive = !!value; continue; }
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      if (field === 'price') {
        if (mode === 'set') v.price = num; else if (mode === 'add') v.price = (v.price || 0) + num; else if (mode === 'sub') v.price = (v.price || 0) - num;
        if (v.price < 0) v.price = 0;
      } else if (field === 'stock') {
        if (mode === 'set') v.stock = Math.max(0, Math.floor(num));
        else if (mode === 'add') v.stock = Math.max(0, Math.floor((v.stock || 0) + num));
        else if (mode === 'sub') v.stock = Math.max(0, Math.floor((v.stock || 0) - num));
      }
    }
    await product.save();
    const populated = await Product.findById(id).select('variants').populate('variants.attributes.attribute').populate('variants.attributes.value');
    res.json(populated?.variants || []);
  } catch (e) {
    res.status(500).json({ message: 'Failed to bulk update variants' });
  }
};

// Delete one variant from a product
export const deleteVariant = async (req, res) => {
  try {
    const { id, variantId } = req.params;
    // Validate ObjectIds early to avoid cast errors surfacing as 500s
    const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    if (!isObjectId(id) || !isObjectId(variantId)) {
      return res.status(400).json({ message: 'Invalid product or variant id' });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const v = (product.variants || []).id(variantId);
    if (!v) return res.status(404).json({ message: 'Variant not found' });

    // Do not allow hard delete when warehouse inventory rows exist for this variant
    try {
      const invCount = await Inventory.countDocuments({ product: id, variantId });
      if (invCount > 0) {
        return res.status(409).json({
          message: 'Cannot delete variant because it has inventory entries in one or more warehouses. Use inventory endpoints to move/delete stock or set quantity to 0, or disable the variant instead.'
        });
      }
    } catch (checkErr) {
      console.warn('deleteVariant: inventory check failed', checkErr?.message || checkErr);
    }

    // Remove the subdocument and save product
    if (typeof v.remove === 'function') {
      v.remove();
    } else if (typeof v.deleteOne === 'function') {
      await v.deleteOne();
      product.variants = (product.variants || []).filter((vv) => String(vv._id) !== String(variantId));
    } else {
      product.variants = (product.variants || []).filter((vv) => String(vv._id) !== String(variantId));
    }
    await product.save();
    // Return updated variants (populated) so client can refresh list
    const populated = await Product.findById(id)
      .select('variants')
      .populate('variants.attributes.attribute')
      .populate('variants.attributes.value');
    res.json(populated?.variants || []);
  } catch (e) {
    console.error('deleteVariant error', e);
    res.status(500).json({ message: 'Failed to delete variant' });
  }
};

 
export const getAttributeValueImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { attributeId, valueId } = req.query;
    const product = await Product.findById(id).select('attributeImages');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const match = (product.attributeImages || []).find(x => String(x.attribute) === String(attributeId) && String(x.value) === String(valueId));
    res.json(match?.images || []);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load images' });
  }
};

// Set images for attribute value (replace)
export const setAttributeValueImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { attributeId, valueId, images } = req.body || {};
    if (!attributeId || !valueId || !Array.isArray(images)) {
      return res.status(400).json({ message: 'attributeId, valueId, and images[] are required' });
    }
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const ai = Array.isArray(product.attributeImages) ? product.attributeImages : [];
    const idx = ai.findIndex(x => String(x.attribute) === String(attributeId) && String(x.value) === String(valueId));
    const cleaned = images.filter(i => typeof i === 'string' && i.trim());
    if (idx >= 0) {
      ai[idx].images = cleaned;
    } else {
      ai.push({ attribute: attributeId, value: valueId, images: cleaned });
    }
    product.attributeImages = ai;
    await product.save();
    res.json(cleaned);
  } catch (e) {
    res.status(500).json({ message: 'Failed to set images' });
  }
};

// Bulk create products from parsed data (JSON from client-parsed Excel/CSV)
export const bulkCreateProducts = async (req, res) => {
  try {
    const { products } = req.body || {};
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'No products provided' });
    }

    const results = [];

    // Helper to resolve category input (ObjectId string or category name)
    const resolveCategory = async (input) => {
      if (!input) return null;
      // Treat as ObjectId if 24-hex
      if (typeof input === 'string' && /^[a-fA-F0-9]{24}$/.test(input)) {
        const cat = await Category.findById(input);
        return cat ? cat._id : null;
      }
      // Otherwise find by name case-insensitive
      const cat = await Category.findOne({ name: new RegExp(`^${String(input).trim()}$`, 'i') });
      return cat ? cat._id : null;
    };

    for (let i = 0; i < products.length; i++) {
      const row = products[i];
      try {
        const resolvedCategoryId = await resolveCategory(row.category);
        if (!resolvedCategoryId) {
          throw new Error(`Category not found: ${row.category}`);
        }

        // Normalize booleans and arrays if client sent strings
        const normalizeColors = (colors) => {
          if (Array.isArray(colors)) return colors;
          if (typeof colors === 'string') {
            // Accept formats like "Red:#FF0000 | Blue:#0000FF" or CSV
            return colors
              .split(/\|\s*|,\s*/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map((pair) => {
                const [name, code] = pair.split(/[:\-]\s*/);
                return { name: name?.trim(), code: code?.trim() };
              });
          }
          return [];
        };

        const normalizeSizes = (sizes) => {
          if (Array.isArray(sizes)) return sizes;
          if (typeof sizes === 'string') {
            // Accept formats like "S:10 | M:5" or CSV
            return sizes
              .split(/\|\s*|,\s*/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map((pair) => {
                const [name, stockStr] = pair.split(':');
                const stock = Number(stockStr);
                return { name: name?.trim(), stock: Number.isFinite(stock) ? stock : 0 };
              });
          }
          return [];
        };

        const images = Array.isArray(row.images)
          ? row.images
          : typeof row.images === 'string'
            ? row.images.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
            : [];

        const body = {
          name: row.name,
          description: row.description,
          price: Number(row.price),
          originalPrice: row.originalPrice != null && row.originalPrice !== '' ? Number(row.originalPrice) : undefined,
          images,
          category: resolvedCategoryId,
          colors: normalizeColors(row.colors),
          sizes: normalizeSizes(row.sizes),
          isNew: typeof row.isNew === 'string' ? /^(true|1|yes)$/i.test(row.isNew) : Boolean(row.isNew),
          isFeatured: typeof row.isFeatured === 'string' ? /^(true|1|yes)$/i.test(row.isFeatured) : Boolean(row.isFeatured),
          currency: row.currency || 'USD'
        };

        // Validate product data
        const { isValid, errors } = validateProductData(body);
        if (!isValid) {
          throw new Error(errors.join('; '));
        }

        // Handle image validation
        const validatedImages = await handleProductImages(body.images);

        // Store provided prices directly
        const priceInUSD = body.price;
        const originalInUSD = body.originalPrice;

        // Create product
        const product = new Product({
          name: body.name,
          description: body.description,
          price: priceInUSD,
          originalPrice: originalInUSD,
          images: validatedImages,
          category: body.category,
          colors: body.colors,
          sizes: body.sizes,
          isNew: body.isNew,
          isFeatured: body.isFeatured,
          order: body.isFeatured ? await Product.countDocuments({ isFeatured: true }) : 0
        });

        const savedProduct = await product.save();

        // Create inventory per size/color combination
        const sizes = body.sizes || [];
        const colors = body.colors || [];
        const inventoryPromises = sizes.flatMap((size) =>
          (colors.length ? colors : [{ name: 'Default', code: '#000000' }]).map((color) =>
            new Inventory({
              product: savedProduct._id,
              size: size.name,
              color: color.name,
              quantity: size.stock,
              location: 'Main Warehouse',
              lowStockThreshold: 5
            }).save()
          )
        );

        await Promise.all(inventoryPromises);

        // Inventory history
        const totalQty = sizes.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
        await new InventoryHistory({
          product: savedProduct._id,
          type: 'increase',
          quantity: totalQty,
          reason: 'Bulk upload initial stock',
          user: req.user?._id
        }).save();

        results.push({ index: i, status: 'success', id: savedProduct._id });
      } catch (err) {
        console.error(`Bulk product row ${i} failed:`, err);
        results.push({ index: i, status: 'failed', error: err.message });
      }
    }

    const summary = {
      total: products.length,
      success: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      results
    };

    const status = summary.failed === 0 ? 201 : (summary.success > 0 ? 207 : 400);
    res.status(status).json(summary);
  } catch (error) {
    console.error('Error in bulkCreateProducts:', error);
    res.status(500).json({ message: 'Failed to bulk create products' });
  }
};

// Translate and persist product fields (name/description) into i18n maps
// POST /api/products/:id/translate
// body: { to: 'ar'|'he'|'en'|..., fields?: ['name','description'] }
export const translateProductFields = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, fields } = req.body || {};
    if (!to || typeof to !== 'string') {
      return res.status(400).json({ message: 'Missing target language "to"' });
    }
    const allowed = new Set(['name', 'description']);
    const targets = Array.isArray(fields) && fields.length ? fields.filter(f => allowed.has(f)) : ['name', 'description'];
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const updates = {};
    for (const field of targets) {
      const src = product[field];
      if (typeof src !== 'string' || !src.trim()) continue;
      try {
        const translated = await deepseekTranslate(src, 'auto', to);
        const mapField = field + '_i18n';
        if (!updates[mapField]) updates[mapField] = new Map(product[mapField] || []);
        updates[mapField].set(to, translated);
      } catch (e) {
        return res.status(502).json({ message: `Translation failed for ${field}`, error: e?.message || 'translate_failed' });
      }
    }
    // Apply updates
    Object.entries(updates).forEach(([k, v]) => {
      product[k] = v;
    });
    await product.save();
    res.json({ message: 'Translated', product });
  } catch (e) {
    console.error('translateProductFields error', e);
    res.status(500).json({ message: 'Failed to translate product' });
  }
};

// Batch translate many products
// POST /api/products/translate/batch
// body: { ids: string[], to: string, fields?: ['name','description'] }
export const batchTranslateProducts = async (req, res) => {
  try {
    const { ids, to, fields } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'ids[] required' });
    if (!to || typeof to !== 'string') return res.status(400).json({ message: 'Missing target language "to"' });
    const allowed = new Set(['name', 'description']);
    const targets = Array.isArray(fields) && fields.length ? fields.filter(f => allowed.has(f)) : ['name', 'description'];

    const products = await Product.find({ _id: { $in: ids } }).select('name description name_i18n description_i18n');
    const out = [];

    for (const p of products) {
      const updates = {};
      for (const field of targets) {
        const src = p[field];
        if (typeof src !== 'string' || !src.trim()) continue;
        try {
          const translated = await deepseekTranslate(src, 'auto', to);
          const mapField = field + '_i18n';
          if (!updates[mapField]) updates[mapField] = new Map(p[mapField] || []);
          updates[mapField].set(to, translated);
        } catch (e) {
          out.push({ id: p._id, field, status: 'failed', error: e?.message || 'translate_failed' });
        }
      }
      Object.entries(updates).forEach(([k, v]) => { p[k] = v; });
      await p.save();
      out.push({ id: p._id, status: 'ok' });
    }
    res.json({ results: out });
  } catch (e) {
    console.error('batchTranslateProducts error', e);
    res.status(500).json({ message: 'Failed to batch translate products' });
  }
};

// Admin: Get i18n maps (name/description) for a product
export const getProductI18n = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Product.findById(id).select('name_i18n description_i18n').lean();
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    const toObj = (m) => {
      if (!m) return {};
      if (typeof m.get === 'function') {
        const out = {}; for (const [k, v] of m.entries()) out[k] = v; return out;
      }
      return m; // already a plain object after .lean()
    };
    return res.json({ name: toObj(doc.name_i18n), description: toObj(doc.description_i18n) });
  } catch (e) {
    console.error('getProductI18n error', e);
    res.status(500).json({ message: 'Failed to load i18n maps' });
  }
};

// Admin: Set i18n maps (merge) for a product
// body: { name?: { [lang]: string }, description?: { [lang]: string } }
export const setProductI18n = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body || {};
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    let changed = false;
    if (name && typeof name === 'object') {
      const map = new Map(product.name_i18n || []);
      for (const [lang, val] of Object.entries(name)) {
        const v = (typeof val === 'string') ? val.trim() : '';
        if (!v) {
          // remove key to fallback to default
          if (map.has(lang)) { map.delete(lang); changed = true; }
        } else {
          const prev = map.get(lang);
          if (prev !== v) { map.set(lang, v); changed = true; }
        }
      }
      product.name_i18n = map;
    }
    if (description && typeof description === 'object') {
      const map = new Map(product.description_i18n || []);
      for (const [lang, val] of Object.entries(description)) {
        const v = (typeof val === 'string') ? val.trim() : '';
        if (!v) {
          if (map.has(lang)) { map.delete(lang); changed = true; }
        } else {
          const prev = map.get(lang);
          if (prev !== v) { map.set(lang, v); changed = true; }
        }
      }
      product.description_i18n = map;
    }
    if (changed) await product.save();
    res.json({ ok: true });
  } catch (e) {
    console.error('setProductI18n error', e);
    res.status(500).json({ message: 'Failed to save i18n maps' });
  }
};
