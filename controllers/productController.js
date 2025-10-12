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
import Inventory from '../models/Inventory.js';
import InventoryHistory from '../models/InventoryHistory.js';
import Category from '../models/Category.js';
import Warehouse from '../models/Warehouse.js';
import { validateProductData } from '../utils/validation.js';
import { handleProductImages } from '../utils/imageHandler.js';
import cloudinary from '../services/cloudinaryClient.js';
import { cacheGet, cacheSet } from '../utils/cache/simpleCache.js';
// Currency conversion disabled for product storage/display; prices are stored and served as-is in store currency

// Get all products
// Shared query builder so both product listing and facet endpoints derive sizes/colors from actual filtered product set
function buildProductQuery(params) {
  const { search, category, categories, isNew, isFeatured, onSale, includeInactive, colors, sizes, size, color, minPrice, maxPrice, primaryOnly, strictCategory } = params;
  let query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  if (category) {
    // If primaryOnly or strictCategory specified, match only primary category field
    if (primaryOnly === 'true' || strictCategory === 'true') {
      query.$and = [...(query.$and || []), { category }];
    } else {
      // Default behavior: product matches if category is primary or listed in additional categories
      query.$and = [...(query.$and || []), { $or: [ { category }, { categories: category } ] }];
    }
  }
  if (categories) {
    const list = String(categories).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) {
      query.$and = [ ...(query.$and || []), { $or: [ { category: { $in: list } }, { categories: { $in: list } } ] } ];
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

  if (!includeInactive || includeInactive === 'false') query.isActive = { $ne: false };
  return query;
}

export const getProducts = async (req, res) => {
  try {
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

    if (forceEmpty) {
      return res.json([]);
    }
    const query = buildProductQuery(req.query);

    const products = await Product.find(query)
      .select('+colors.name +colors.code +colors.images +colors.sizes')
      // Populate primary & additional categories so client can show names
      .populate('category')
      .populate('categories')
      .populate('relatedProducts')
      .populate({ path: 'reviews.user', select: 'name email image' })
      .sort({ isFeatured: -1, order: 1, createdAt: -1 });

    const productsWithInventory = await Promise.all(
      products.map(async (product) => {
        const inventory = await Inventory.find({ product: product._id });
        const productObj = product.toObject();
        productObj.inventory = inventory;
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

    const baseQuery = buildProductQuery(req.query);

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
    
    const product = await Product.findById(req.params.id)
      .populate('category')
      .populate('categories')
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

    // No runtime currency conversion

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

    const baseDoc = {
      name: req.body.name,
      description: req.body.description,
      price: req.body.price,
      originalPrice: req.body.originalPrice,
      images: req.body.images,
      stock: req.body.stock,
      category: req.body.category,
      categories: categoriesArray,
      isNew: !!req.body.isNew,
      isFeatured: !!req.body.isFeatured,
      sizeGuide,
      videoUrls,
      order: req.body.isFeatured ? await Product.countDocuments({ isFeatured: true }) : 0
    };

    if (!simpleMode) {
      baseDoc.colors = req.body.colors; // legacy path
    }

    const product = new Product(baseDoc);
  let savedProduct = await product.save();
  // Populate categories before responding so client gets names immediately
  savedProduct = await savedProduct.populate(['category','categories']);


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

// Update product
export const updateProduct = async (req, res) => {
  try {
    const { sizes, colors: incomingColors, videoUrls: incomingVideoUrls, sizeGuide: incomingSizeGuide, categories: incomingCategories, isActive: incomingIsActive, slug: incomingSlug, metaTitle, metaDescription, metaKeywords, ogTitle, ogDescription, ogImage, ...updateData } = req.body;
    // Start with shallow copy of remaining fields
    const updateDataSanitized = { ...updateData };

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

    // Handle isActive flag
    if (incomingIsActive !== undefined) {
      updateDataSanitized.isActive = !!incomingIsActive;
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
        colors.map(color => ({
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

  product = await product.populate(['category','categories']);
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
      .select('name price images category colors')
      .limit(12)
      .sort('-createdAt');
    if (process.env.NODE_ENV !== 'production') {
      console.log(`searchProducts query="${query}" matches=${products.length} categoriesMatched=${categoryIds.length}`);
    }
    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ message: 'Failed to search products' });
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
