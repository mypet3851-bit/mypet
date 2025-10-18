import mongoose from 'mongoose';

// Translation cache for AI-provided translations (e.g., DeepSeek)
// Uniqueness is enforced by (from, to, hash). Hash is computed from normalized source text and optional contextKey.
const translationSchema = new mongoose.Schema({
  from: { type: String, required: true, trim: true, lowercase: true },
  to: { type: String, required: true, trim: true, lowercase: true },
  // Optional namespacing (e.g., i18n key like "home.header.title" or model+field like "Product.name")
  contextKey: { type: String, default: '' },
  sourceText: { type: String, required: true },
  translatedText: { type: String, required: true },
  // Hash for the normalized sourceText + contextKey to ensure deterministic cache keys
  hash: { type: String, required: true },
  provider: { type: String, default: 'deepseek' },
  model: { type: String, default: '' },
  usageCount: { type: Number, default: 0, min: 0 },
  lastUsedAt: { type: Date, default: null }
}, { timestamps: true });

translationSchema.index({ from: 1, to: 1, hash: 1 }, { unique: true, name: 'uniq_from_to_hash' });
translationSchema.index({ contextKey: 1 });

const Translation = mongoose.models.Translation || mongoose.model('Translation', translationSchema);
export default Translation;
