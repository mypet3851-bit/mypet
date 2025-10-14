import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: false, trim: true },
    // SEO-friendly identifier; optional historically, now recommended
    slug: { type: String, required: false, trim: true, lowercase: true, index: true, unique: true, sparse: true },
    label: { type: String, required: false, trim: true },
  labelImageUrl: { type: String, required: false },
    imageUrl: { type: String, required: false },
    linkUrl: { type: String, required: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model('Brand', brandSchema);
