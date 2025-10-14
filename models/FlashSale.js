import mongoose from 'mongoose';

const flashSaleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  flashPrice: { type: Number, required: true },
  quantityLimit: { type: Number, default: 0 }, // 0 = unlimited per order
  order: { type: Number, default: 0 }
}, { _id: false });

const flashSaleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  items: [flashSaleItemSchema],
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

flashSaleSchema.index({ startDate: 1, endDate: 1 });

export default mongoose.model('FlashSale', flashSaleSchema);
