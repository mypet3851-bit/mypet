import mongoose from 'mongoose';

const pageLayoutSchema = new mongoose.Schema({
  sections: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  // Global vertical gap (Tailwind scale number). Frontend interprets as gap * 0.25rem.
  sectionGap: {
    type: Number,
    default: 6
  }
}, {
  timestamps: true
});

// Ensure a singleton document pattern
pageLayoutSchema.statics.getOrCreate = async function() {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({ sections: [], sectionGap: 6 });
  } else if (typeof doc.sectionGap !== 'number') {
    // Migration: ensure gap exists
    doc.sectionGap = 6;
    await doc.save();
  }
  return doc;
};

const PageLayout = mongoose.model('PageLayout', pageLayoutSchema);

export default PageLayout;
