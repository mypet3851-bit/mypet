import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    type: String,
    required: [true, 'Category image is required']
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
  }
}, {
  timestamps: true
});

// Create a more robust slug from name before saving
categorySchema.pre('save', async function(next) {
  try {
    if (!this.name) {
      throw new Error('Category name is required');
    }

    // Create base slug from name
    let baseSlug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-'); // Replace multiple hyphens with single hyphen

    // If slug is empty after cleaning, use a default
    if (!baseSlug) {
      baseSlug = 'category';
    }

    // Check if slug exists
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      // Skip checking if this is a new document and slug hasn't changed
      if (!this.isNew && this.slug === slug) {
        break;
      }

      const existingCategory = await mongoose.model('Category').findOne({ slug });
      
      if (!existingCategory) {
        break;
      }

      // Add counter to slug
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
    next();
  } catch (error) {
    next(error);
  }
});

// Add index for slug with collation for case-insensitive uniqueness
categorySchema.index({ slug: 1 }, { 
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

export default mongoose.model('Category', categorySchema);