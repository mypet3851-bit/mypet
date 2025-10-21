import express from 'express';
import fetch from 'node-fetch';
import Order from '../models/Order.js';
import { loadSettings, buildICreditRequest } from '../services/icreditService.js';

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

export default router;

// Create hosted payment session for iCredit from an existing order
router.post('/icredit/create-session', async (req, res) => {
  try {
    const { orderId, overrides } = req.body || {};
    if (!orderId) return res.status(400).json({ message: 'orderId required' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'order_not_found' });

    const settings = await loadSettings();
    const cfg = settings?.payments?.icredit || {};
    if (!cfg?.enabled) return res.status(400).json({ message: 'icredit_disabled' });
    if (!cfg?.groupPrivateToken) return res.status(400).json({ message: 'missing_token' });
    const apiUrl = cfg.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';

    const body = buildICreditRequest({ order, settings, overrides });
    // iCredit expects JSON body
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    if (!r.ok) return res.status(400).json({ message: 'icredit_call_failed', status: r.status, body: text.slice(0, 1000) });
    // Response may include URL in plain text or JSON; try parse then fallback
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const url = parsed?.Url || parsed?.url || parsed?.PaymentUrl || text;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ message: 'invalid_redirect_url', raw: text.slice(0, 1000) });
    }
    return res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
