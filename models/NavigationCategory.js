import mongoose from 'mongoose';

const navigationCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Optional display sub-categories (kept for backwards compatibility with existing UI)
  subCategories: [{
    name: {
      type: String,
      required: true
    },
    slug: {
      type: String,
      required: true
    }
  }],
  // Canonical mapping to catalog categories; allows selecting multiple categories per nav item
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    index: true
  }]
}, {
  timestamps: true
});

// Create slug from name (if needed) and sync categories from subCategories before saving
navigationCategorySchema.pre('save', async function(next) {
  try {
    // 1) Ensure slug exists and is unique
    if (this.isModified('name') || !this.slug) {
      const base = (this.name || this.slug || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

      let desired = base || 'nav';
      let candidate = desired;

      // If updating and slug already matches, skip uniqueness loop
      let counter = 1;
      while (await this.constructor.findOne({ slug: candidate, _id: { $ne: this._id } })) {
        candidate = `${desired}-${counter}`;
        counter++;
      }
      this.slug = candidate;
    }

    // 2) If categories not provided explicitly, try to resolve from subCategories slugs
    const hasExplicitCategories = Array.isArray(this.categories) && this.isModified('categories');
    const hasSubCats = Array.isArray(this.subCategories) && this.subCategories.length > 0;

    if (!hasExplicitCategories && hasSubCats) {
      const slugs = this.subCategories
        .map(sc => sc && sc.slug)
        .filter(Boolean);
      if (slugs.length > 0) {
        const Category = mongoose.model('Category');
        const docs = await Category.find({ slug: { $in: slugs } }).select('_id slug');
        this.categories = docs.map(d => d._id);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

export default mongoose.model('NavigationCategory', navigationCategorySchema);
