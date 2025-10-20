import express from 'express';
import PageLayout from '../models/PageLayout.js';
import { auth, adminAuth } from '../middleware/auth.js';

const router = express.Router();

// Get current layout sections
router.get('/', async (req, res) => {
  try {
    const doc = await PageLayout.getOrCreate();
    res.json({ sections: doc.sections, sectionGap: doc.sectionGap });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Determine required guard for updates: admin-only by default in production, configurable via env
const requireAdminEnv = String(process.env.LAYOUT_UPDATE_REQUIRE_ADMIN ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase();
const REQUIRE_ADMIN = ['1','true','yes','on'].includes(requireAdminEnv);
const updateGuard = REQUIRE_ADMIN ? adminAuth : auth;

// Replace all sections (guarded)
router.put('/', updateGuard, async (req, res) => {
  try {
    const { sections, sectionGap } = req.body || {};
    if (!Array.isArray(sections)) {
      return res.status(400).json({ message: 'Invalid payload: sections must be an array' });
    }
    if (sectionGap !== undefined && (typeof sectionGap !== 'number' || sectionGap < 0 || sectionGap > 64)) {
      return res.status(400).json({ message: 'Invalid sectionGap' });
    }

    const doc = await PageLayout.getOrCreate();
    doc.sections = sections;
    if (typeof sectionGap === 'number') doc.sectionGap = sectionGap;
    doc.markModified('sections');
    await doc.save();

    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'layout_updated', data: { sections: doc.sections, sectionGap: doc.sectionGap } });
      }
    } catch {}

    res.json({ sections: doc.sections, sectionGap: doc.sectionGap });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
