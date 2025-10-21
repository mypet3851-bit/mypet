import express from 'express';
import Order from '../models/Order.js';
import { loadSettings, requestICreditPaymentUrl, buildICreditRequest } from '../services/icreditService.js';

const router = express.Router();

// iCredit IPN webhook (public)
router.post('/icredit/ipn', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[payments][icredit][ipn]', JSON.stringify(payload).slice(0, 2000));
    // TODO: verify authenticity and update order status accordingly
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'ipn_error' });
  }
});

// Create hosted payment session for iCredit from an existing order
router.post('/icredit/create-session', async (req, res) => {
  try {
    const { orderId, overrides } = req.body || {};
    if (!orderId) return res.status(400).json({ message: 'orderId required' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'order_not_found' });

    const settings = await loadSettings();
    try {
      const { url } = await requestICreditPaymentUrl({ order, settings, overrides });
      return res.json({ ok: true, url });
    } catch (e) {
      const msg = e?.message || 'icredit_call_failed';
      const status = e?.status || 400;
      return res.status(400).json({ message: 'icredit_call_failed', status, detail: msg });
    }
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
