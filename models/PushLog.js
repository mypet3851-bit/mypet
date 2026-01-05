import mongoose from 'mongoose';

const pushLogSchema = new mongoose.Schema({
  title: String,
  body: String,
  data: {},
  imageUrl: { type: String },
  audience: { type: Object },
  tokensCount: { type: Number, default: 0 },
  nid: { type: String, index: true },
  result: {},
  sentAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

pushLogSchema.index({ sentAt: -1 });

const PushLog = mongoose.model('PushLog', pushLogSchema);
export default PushLog;
