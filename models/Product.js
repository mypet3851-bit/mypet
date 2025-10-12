import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative']
  },
  discount: {
    type: Number,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%']
  },
  images: [{
    type: String,
    required: [true, 'At least one product image is required']
  }],
  // Optional product videos (e.g., MP4, WebM, hosted links or CDN)
  videoUrls: [{
    type: String,
    validate: {
      validator: function(v) {
        if (!v) return true;
        // Basic URL or relative path check
        return /^(https?:\/\/|\/)/i.test(v);
      },
      message: 'Invalid video URL'
    }
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required']
  },
  // Additional categories (multi-category support). Primary category remains in `category` for backward compatibility.
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  // Legacy variant structure (colors with nested sizes). Optional now; new products can omit for simple single-SKU flow.
  colors: [{
    name: { type: String },
    code: { type: String },
    images: [{ type: String }],
    sizes: [{
      name: { type: String },
      stock: { type: Number, min: 0 }
    }]
  }],
  isNew: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviews: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      required: true
    },
    photos: [{
      type: String
    }],
    helpful: {
      type: Number,
      default: 0
    },
    reported: {
      type: Boolean,
      default: false
    },
    verified: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  stock: {
    type: Number,
    required: [true, 'Product stock is required'],
    min: [0, 'Stock cannot be negative']
  },
  relatedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }]
  ,
  // Product Add-ons (upsell items shown on product page)
  addOns: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  // Active/Inactive (soft delete) status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  // SEO & Marketing
  slug: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  metaTitle: { type: String },
  metaDescription: { type: String },
  metaKeywords: [{ type: String }],
  ogTitle: { type: String },
  ogDescription: { type: String },
  ogImage: { type: String },
  // Version counter for images array (used for client cache busting)
  imagesVersion: {
    type: Number,
    default: 0
  },
  // Per-product size guide (دليل المقاسات)
  sizeGuide: {
    // Optional title (e.g., "Men's Shirts")
    title: { type: String },
    // Unit system: 'cm' | 'in'
    unit: { type: String, enum: ['cm', 'in'], default: 'cm' },
    // Table rows: each row corresponds to a size label and measurement columns
    rows: [{
      size: { type: String, required: true },
      chest: { type: Number },
      waist: { type: Number },
      hip: { type: Number },
      length: { type: Number },
      sleeve: { type: Number }
    }],
    // Extra notes / how to measure text
    note: { type: String }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  suppressReservedKeysWarning: true
});

// Virtual for average rating
productSchema.virtual('averageRating').get(function() {
  if (!this.reviews || this.reviews.length === 0) return 0;
  const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
  return (sum / this.reviews.length).toFixed(1);
});

// Pre-save middleware to calculate discount
productSchema.pre('save', function(next) {
  if (this.originalPrice && this.price) {
    this.discount = Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  next();
});

// Pre-save middleware to update total stock
// Recompute aggregate stock from nested colors.sizes each save
productSchema.pre('save', function(next) {
  // If legacy variant data exists, derive stock from nested sizes; otherwise keep provided stock untouched.
  if (this.colors && this.colors.length > 0) {
    const total = this.colors.reduce((sum, color) => {
      if (color && Array.isArray(color.sizes) && color.sizes.length) {
        return sum + color.sizes.reduce((s, sz) => s + (Number(sz.stock) || 0), 0);
      }
      return sum;
    }, 0);
    if (total > 0) {
      this.stock = total;
    }
  }
  next();
});

// Slug generation / normalization
productSchema.pre('save', async function(next) {
  try {
    if (!this.isModified('name') && this.slug) return next();
    // Basic slugify: lowercase, remove diacritics, spaces -> '-', keep alphanum & dashes
    const base = (this.slug || this.name || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (!base) return next();
    let candidate = base;
    let i = 1;
    while (await mongoose.models.Product.findOne({ slug: candidate, _id: { $ne: this._id } })) {
      candidate = `${base}-${i++}`;
      if (i > 50) break; // safety cap
    }
    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model('Product', productSchema);