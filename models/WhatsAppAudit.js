import mongoose from 'mongoose';

const whatsappAuditSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  message: { type: String, required: true },
  messageHash: { type: String, index: true },
  generatedLinks: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  context: { type: Object },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

whatsappAuditSchema.index({ createdAt: -1 });

const WhatsAppAudit = mongoose.model('WhatsAppAudit', whatsappAuditSchema);
export default WhatsAppAudit;
