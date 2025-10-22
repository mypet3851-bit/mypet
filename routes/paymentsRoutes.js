import express from 'express';
import Order from '../models/Order.js';
import { adminAuth } from '../middleware/auth.js';
import { loadSettings, requestICreditPaymentUrl, buildICreditRequest, buildICreditCandidates, diagnoseICreditConnectivity, pingICredit } from '../services/icreditService.js';

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

// List derived iCredit endpoint candidates from current settings (diagnostic, no network calls)
router.get('/icredit/candidates', async (req, res) => {
  try {
    const settings = await loadSettings();
    const base = settings?.payments?.icredit?.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';
    const list = buildICreditCandidates(base);
    return res.json({ ok: true, base, candidates: Array.from(new Set(list)).slice(0, 12) });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'candidates_error' });
  }
});

// Diagnose connectivity/DNS to iCredit endpoints (admin only)
router.get('/icredit/diagnose', adminAuth, async (req, res) => {
  try {
    const settings = await loadSettings();
    const base = settings?.payments?.icredit?.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';
    const diag = await diagnoseICreditConnectivity(base);
    return res.json({ ok: true, ...diag });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'diagnose_error' });
  }
});

// Admin-only: quick ping of iCredit endpoints (JSON and SOAP) with minimal payload
router.get('/icredit/ping', adminAuth, async (req, res) => {
  try {
    const useReal = String(req.query.useReal || '').trim() === '1' || String(req.query.real || '').trim() === '1';
    const out = await pingICredit({ useRealToken: useReal });
    return res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'ping_error' });
  }
});

// Preview the exact JSON payload we would send to iCredit GetUrl for a given order (admin only)
router.get('/icredit/preview-request', adminAuth, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    if (!orderId) return res.status(400).json({ message: 'orderId required' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'order_not_found' });

    const settings = await loadSettings();
    const payload = buildICreditRequest({ order, settings, overrides: {} });
    const base = settings?.payments?.icredit?.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';
    const candidates = buildICreditCandidates(base).slice(0, 8);
    // Mask sensitive values in settings snapshot
    const snap = {
      enabled: !!settings?.payments?.icredit?.enabled,
      apiUrl: base,
      transport: settings?.payments?.icredit?.transport || 'auto',
      groupPrivateToken: settings?.payments?.icredit?.groupPrivateToken ? '***' : ''
    };
    return res.json({ ok: true, orderId, settings: snap, payload, candidates });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'preview_error' });
  }
});

// Create hosted payment session for iCredit from an existing order
router.post('/icredit/create-session', async (req, res) => {
  try {
    const { orderId, overrides } = req.body || {};
    if (!orderId) return res.status(400).json({ message: 'orderId required' });
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'order_not_found' });

    // Diagnostic: log incoming request context (mask sensitive headers)
    try {
      const hdrAuth = req.header('Authorization');
      console.log('[payments][icredit][create-session] incoming', {
        time: new Date().toISOString(),
        ip: req.ip,
        ua: req.headers['user-agent'],
        origin: req.headers.origin || '',
        referer: req.headers.referer || '',
        auth: hdrAuth ? 'present' : 'none',
        orderId,
        orderNumber: order.orderNumber,
        currency: order.currency,
        items: (order.items || []).length,
        totalAmount: order.totalAmount,
        shippingFee: order.shippingFee ?? order.deliveryFee ?? 0
      });
    } catch {}

    const settings = await loadSettings();
    try {
      const { url } = await requestICreditPaymentUrl({ order, settings, overrides });
      try { console.log('[payments][icredit][create-session] success url=%s', url); } catch {}
      return res.json({ ok: true, url });
    } catch (e) {
      const msg = e?.message || 'icredit_call_failed';
      const status = e?.status || 400;
      try { console.warn('[payments][icredit][create-session] failed status=%s detail=%s', status, msg); if (e?.stack) console.warn(e.stack.split('\n').slice(0,3).join(' | ')); } catch {}
      return res.status(400).json({ message: 'icredit_call_failed', status, detail: msg });
    }
  } catch (e) {
    try { console.error('[payments][icredit][create-session] unhandled', e?.message || e); } catch {}
    res.status(500).json({ message: e.message });
  }
});

export default router;
