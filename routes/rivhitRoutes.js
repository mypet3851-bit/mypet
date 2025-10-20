import express from 'express';
import Settings from '../models/Settings.js';
import { adminAuth } from '../middleware/auth.js';
import { getItemQuantity, updateItem, testConnectivity } from '../services/rivhitService.js';

const router = express.Router();

// Get Rivhit config (mask token)
router.get('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    const r = s.rivhit || {};
    res.json({
      enabled: !!r.enabled,
      apiUrl: r.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc',
      tokenApi: r.tokenApi ? '***' : '',
      defaultStorageId: r.defaultStorageId || 0,
      transport: r.transport || 'json'
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update Rivhit config
router.put('/config', adminAuth, async (req, res) => {
  try {
    let s = await Settings.findOne().sort({ updatedAt: -1 });
    if (!s) s = new Settings();
    const inc = req.body || {};
    s.rivhit = s.rivhit || { enabled: false, apiUrl: 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc', tokenApi: '', defaultStorageId: 0, transport: 'json' };
    if (typeof inc.enabled !== 'undefined') s.rivhit.enabled = !!inc.enabled;
    if (typeof inc.apiUrl === 'string') s.rivhit.apiUrl = inc.apiUrl.trim();
    if (typeof inc.defaultStorageId !== 'undefined') {
      const n = Number(inc.defaultStorageId);
      s.rivhit.defaultStorageId = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    if (typeof inc.transport === 'string' && ['json', 'soap'].includes(inc.transport)) {
      s.rivhit.transport = inc.transport;
    }
    if (typeof inc.tokenApi === 'string') {
      if (inc.tokenApi !== '***') s.rivhit.tokenApi = inc.tokenApi.trim();
    }
    try { s.markModified('rivhit'); } catch {}
    await s.save();
    res.json({ enabled: s.rivhit.enabled, apiUrl: s.rivhit.apiUrl, tokenApi: s.rivhit.tokenApi ? '***' : '', defaultStorageId: s.rivhit.defaultStorageId || 0, transport: s.rivhit.transport || 'json' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Test connectivity
router.get('/test', adminAuth, async (req, res) => {
  try {
    const r = await testConnectivity();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'test_failed' });
  }
});

// Get current quantity for an item
router.post('/quantity', adminAuth, async (req, res) => {
  try {
    const { id_item, storage_id } = req.body || {};
    if (!id_item) return res.status(400).json({ message: 'id_item is required' });
    const r = await getItemQuantity({ id_item, storage_id });
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'quantity_failed', code: e?.code || 0 });
  }
});

// Update item (price/cost/etc.)
router.post('/update', adminAuth, async (req, res) => {
  try {
    const { id_item } = req.body || {};
    if (!id_item) return res.status(400).json({ message: 'id_item is required' });
    const { storage_id, reference_request, ...fields } = req.body || {};
    const r = await updateItem({ id_item, storage_id, reference_request, ...fields });
    res.json(r);
  } catch (e) {
    res.status(400).json({ message: e?.message || 'update_failed', code: e?.code || 0 });
  }
});

export default router;
