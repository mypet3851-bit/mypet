import mongoose from 'mongoose';

const inventoryHistorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  type: {
    type: String,
    enum: ['increase', 'decrease', 'update'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // User may be undefined for guest checkouts or system actions
    required: false,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Performance indexes for analytics queries filtered/sorted by time and product
try { inventoryHistorySchema.index({ timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ product: 1, timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ user: 1, timestamp: -1 }); } catch {}

export default mongoose.model('InventoryHistory', inventoryHistorySchema);