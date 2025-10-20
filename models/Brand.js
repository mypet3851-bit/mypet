import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: false, trim: true },
    imageUrl: { type: String, required: false },
    linkUrl: { type: String, required: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model('Brand', brandSchema);
