import mongoose from 'mongoose';

const pushOpenSchema = new mongoose.Schema({
  nid: { type: String, required: true, index: true },
  expoPushToken: { type: String },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  openedAt: { type: Date, default: Date.now }
}, { timestamps: true });

pushOpenSchema.index({ openedAt: -1 });

const PushOpen = mongoose.model('PushOpen', pushOpenSchema);
export default PushOpen;
