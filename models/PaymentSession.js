import mongoose from 'mongoose';

const PaymentSessionSchema = new mongoose.Schema({
  gateway: { type: String, enum: ['icredit'], required: true, default: 'icredit' },
  status: { type: String, enum: ['created', 'approved', 'failed', 'confirmed'], default: 'created', index: true },
  reference: { type: String, index: true },
  // Cart snapshot to reconstruct the order at confirmation time
  items: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true },
      size: { type: String },
      color: { type: String },
      variantId: { type: String },
      sku: { type: String },
      variants: [
        {
          attributeId: { type: String },
          attributeName: { type: String },
          valueId: { type: String },
          valueName: { type: String }
        }
      ]
    }
  ],
  shippingAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true }
  },
  customerInfo: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    secondaryMobile: { type: String }
  },
  coupon: {
    code: { type: String },
    discount: { type: Number }
  },
  currency: { type: String, required: true },
  shippingFee: { type: Number, default: 0 },
  totalWithShipping: { type: Number },

  // For linking results
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  paymentDetails: { type: mongoose.Schema.Types.Mixed },

  // TTL expiry to auto-clean abandoned sessions
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 3), index: { expires: 0 } } // ~3 days
});

const PaymentSession = mongoose.model('PaymentSession', PaymentSessionSchema);
export default PaymentSession;
