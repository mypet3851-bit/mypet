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
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  subCategories: [{
    name: {
      type: String,
      required: true
    },
    slug: {
      type: String,
      required: true
    }
  }]
}, {
  timestamps: true
});

// Create slug from name before saving
navigationCategorySchema.pre('save', async function(next) {
  if (!this.isModified('name')) {
    return next();
  }

  try {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    // Check if slug exists
    const existingCategory = await this.constructor.findOne({ 
      slug: this.slug,
      _id: { $ne: this._id }
    });

    if (existingCategory) {
      let counter = 1;
      let newSlug = this.slug;
      
      while (await this.constructor.findOne({ 
        slug: newSlug,
        _id: { $ne: this._id }
      })) {
        newSlug = `${this.slug}-${counter}`;
        counter++;
      }
      
      this.slug = newSlug;
    }

    next();
  } catch (error) {
    next(error);
  }
});

export default mongoose.model('NavigationCategory', navigationCategorySchema);