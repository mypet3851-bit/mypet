import express from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Settings from '../models/Settings.js';
import GiftCard from '../models/GiftCard.js';
import PaymentSession from '../models/PaymentSession.js';
import { adminAuth } from '../middleware/auth.js';
import { inventoryService } from '../services/inventoryService.js';
import { loadSettings, requestICreditPaymentUrl, buildICreditRequest, buildICreditCandidates, diagnoseICreditConnectivity, pingICredit } from '../services/icreditService.js';

const router = express.Router();

// iCredit IPN webhook (public)
// Optional source IP allowlist: set ICREDIT_IPN_ALLOWED_IPS as comma-separated IPv4 list to enforce
const __ipnAllowed = parseIpList(process.env.ICREDIT_IPN_ALLOWED_IPS || '');
const __enforceIpnWhitelist = __ipnAllowed.length > 0;
router.post('/icredit/ipn', async (req, res) => {
  try {
    // Basic source IP validation (only if env allowlist provided)
    try {
      const srcIp = getClientIp(req) || (req.ip ? String(req.ip) : '') || '';
      if (__enforceIpnWhitelist && (!srcIp || !__ipnAllowed.includes(srcIp))) {
        try { console.warn('[payments][icredit][ipn] rejecting by IP allowlist', { srcIp, allowed: __ipnAllowed }); } catch {}
        return res.status(403).json({ ok: false, message: 'forbidden_ip' });
      }
      try { console.log('[payments][icredit][ipn] source', { ip: srcIp, enforced: __enforceIpnWhitelist }); } catch {}
    } catch {}
    const payload = req.body || {};
    console.log('[payments][icredit][ipn]', JSON.stringify(payload).slice(0, 2000));
    // Optional: try to mark the session approved using Custom1 (we still require /confirm to create order)
    try {
      const maybeId = String(payload?.Custom1 || payload?.Reference || '').trim();
      if (maybeId) {
        const ps = await PaymentSession.findById(maybeId);
        if (ps && ps.status === 'created') {
          ps.status = 'approved';
          ps.paymentDetails = payload;
          await ps.save();
        }
      }
    } catch {}
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
      const clientIp = getClientIp(req);
      console.log('[payments][icredit][create-session] incoming', {
        time: new Date().toISOString(),
        ip: clientIp || req.ip,
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
      let clientIp = getClientIp(req) || getFallbackIpFromEnv();
      if (!clientIp) {
        const bodyIp = validateIPv4(req.body?.clientIp || req.body?.ip || req.body?.ipAddress);
        if (bodyIp) clientIp = bodyIp;
      }
      // Hard fallback to a safe IPv4 literal to satisfy gateways that require IPAddress
      if (!clientIp) {
        clientIp = '1.1.1.1';
      }
      const ipOverrides = clientIp ? { ...overrides, IPAddress: clientIp } : (overrides || {});
      const { url } = await requestICreditPaymentUrl({ order, settings, overrides: ipOverrides });
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

// --- Helpers ---
function deriveOrigin(req) {
  const h = req.headers || {};
  const origin = h.origin || '';
  if (origin) return origin.replace(/\/$/, '');
  const referer = h.referer || '';
  if (referer) {
    try { const u = new URL(referer); return `${u.protocol}//${u.host}`; } catch {}
  }
  const host = h['x-forwarded-host'] || h.host || '';
  const proto = (h['x-forwarded-proto'] || '').split(',')[0] || 'http';
  if (host) return `${proto}://${host}`;
  return process.env.FRONTEND_BASE_URL || '';
}

// Best-effort client IPv4 extractor (for gateways that require an IPAddress field)
function getClientIp(req) {
  try {
    const h = req.headers || {};
    const candidates = [];
    const xff = (h['x-forwarded-for'] || '').toString();
    if (xff) candidates.push(...xff.split(',').map(s => s.trim()).filter(Boolean));
    const cf = (h['cf-connecting-ip'] || '').toString().trim();
    if (cf) candidates.push(cf);
    const xri = (h['x-real-ip'] || '').toString().trim();
    if (xri) candidates.push(xri);
    const xci = (h['x-client-ip'] || '').toString().trim();
    if (xci) candidates.push(xci);
    const sock = (req.socket?.remoteAddress || '').toString().trim();
    if (sock) candidates.push(sock);
    const rip = (req.ip || '').toString().trim();
    if (rip) candidates.push(rip);

    for (let raw of candidates) {
      if (!raw) continue;
      // Remove brackets and ports (e.g., 1.2.3.4:1234)
      let ip = raw.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
      if (/^::ffff:/.test(ip)) ip = ip.replace(/^::ffff:/, '');
      // Accept only IPv4
      const m = ip.match(/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
      if (!m) continue;
      let ok = true;
      for (let i = 1; i <= 4; i++) {
        const n = Number(m[i]);
        if (!Number.isFinite(n) || n < 0 || n > 255) { ok = false; break; }
      }
      if (ok) return ip;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function getFallbackIpFromEnv() {
  const ip = String(process.env.ICREDIT_DEFAULT_IP || '').trim();
  if (!ip) return undefined;
  const m = ip.match(/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
  if (!m) return undefined;
  for (let i = 1; i <= 4; i++) { const n = Number(m[i]); if (!Number.isFinite(n) || n < 0 || n > 255) return undefined; }
  return ip;
}

function validateIPv4(val) {
  if (typeof val !== 'string' || !val.trim()) return undefined;
  let ip = val.trim().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  if (/^::ffff:/.test(ip)) ip = ip.replace(/^::ffff:/, '');
  const m = ip.match(/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
  if (!m) return undefined;
  for (let i = 1; i <= 4; i++) { const n = Number(m[i]); if (!Number.isFinite(n) || n < 0 || n > 255) return undefined; }
  return ip;
}

// Parse comma-separated IPv4 list from env into sanitized array
function parseIpList(val) {
  const list = String(val || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // Normalize IPv4 and drop invalid entries
      let ip = s.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
      if (/^::ffff:/.test(ip)) ip = ip.replace(/^::ffff:/, '');
      const m = ip.match(/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
      if (!m) return '';
      for (let i = 1; i <= 4; i++) { const n = Number(m[i]); if (!Number.isFinite(n) || n < 0 || n > 255) return ''; }
      return ip;
    })
    .filter(Boolean);
  return Array.from(new Set(list));
}

// Create hosted payment session WITHOUT creating an Order upfront
router.post('/icredit/create-session-from-cart', async (req, res) => {
  try {
    const body = req.body || {};
    const { items, shippingAddress, customerInfo, currency, shippingFee, coupon } = body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'items required' });
    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.country) return res.status(400).json({ message: 'invalid_shipping' });
    if (!customerInfo?.email || !customerInfo?.mobile) return res.status(400).json({ message: 'invalid_customer' });
    if (!currency) return res.status(400).json({ message: 'currency required' });

    let sessionGiftCard = undefined;
    try {
      const rawGift = body?.giftCard;
      if (rawGift && rawGift.code) {
        const code = String(rawGift.code).trim();
        const amt = Number(rawGift.amount);
        if (code && Number.isFinite(amt) && amt > 0) {
          sessionGiftCard = { code, amount: amt };
        }
      }
    } catch {}

    // Persist a temporary session to tie the gateway redirect back to the cart snapshot
    const ps = await PaymentSession.create({
      gateway: 'icredit',
      status: 'created',
      reference: `PS-${Date.now()}`,
      items: items.map((it) => ({
        product: it.product,
        quantity: it.quantity,
        size: it.size,
        color: (typeof it.color === 'string' ? it.color : (it.color?.name || it.color?.code || undefined)),
        variantId: it.variantId,
        sku: it.sku,
        variants: Array.isArray(it.variants) ? it.variants.map(v => ({
          attributeId: v.attributeId || v.attribute || undefined,
          attributeName: v.attributeName || v.name || undefined,
          valueId: v.valueId || v.value || undefined,
          valueName: v.valueName || v.valueLabel || v.label || undefined
        })) : undefined
      })),
      shippingAddress: {
        street: shippingAddress.street,
        city: shippingAddress.city,
        country: shippingAddress.country
      },
      customerInfo: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        email: customerInfo.email,
        mobile: customerInfo.mobile,
        secondaryMobile: customerInfo.secondaryMobile
      },
      coupon: coupon && coupon.code ? { code: coupon.code, discount: Number(coupon.discount) || 0 } : undefined,
      giftCard: sessionGiftCard,
      currency,
      shippingFee: Number(shippingFee) || 0,
      totalWithShipping: Number(body?.totalWithShipping) || undefined
    });

    // Build a lightweight order-like object for iCredit payload (we'll compute catalog totals on confirmation)
    const orderLike = {
      _id: ps._id,
      items: ps.items.map(it => ({
        product: it.product,
        quantity: it.quantity,
        price: 0, // ignored by iCredit; unit prices can be omitted if HideItemList is true
        name: '',
        sku: it.sku,
        variantId: it.variantId
      })),
      shippingAddress: ps.shippingAddress,
      customerInfo: ps.customerInfo,
      currency,
      orderNumber: ps.reference,
      totalAmount: 0,
      shippingFee: ps.shippingFee
    };

  const settings = await loadSettings();

    // Compute RedirectURL to our frontend return page, preserving any configured base
    const origin = deriveOrigin(req);
    const frontendReturn = origin ? `${origin}/payment/return` : (settings?.payments?.icredit?.redirectURL || '');

    // Allow client to pass optional overrides (e.g., deep links) and support placeholder replacement
    const clientOverrides = (body && typeof body.overrides === 'object' && body.overrides) ? { ...body.overrides } : {};
    // Sanitize any incoming IPAddress override (accept only valid IPv4)
    try {
      if (typeof clientOverrides.IPAddress !== 'undefined') {
        const valid = validateIPv4(String(clientOverrides.IPAddress));
        if (!valid) delete clientOverrides.IPAddress; else clientOverrides.IPAddress = valid;
      }
    } catch {}
    const overrides = {
      RedirectURL: frontendReturn,
      Custom1: String(ps._id),
      Reference: ps.reference,
      ...clientOverrides
    };
    try {
      // Replace {sessionId} placeholder in RedirectURL/FailRedirectURL if present
      const sid = String(ps._id);
      if (typeof overrides.RedirectURL === 'string') overrides.RedirectURL = overrides.RedirectURL.replace('{sessionId}', sid);
      if (typeof overrides.FailRedirectURL === 'string') overrides.FailRedirectURL = overrides.FailRedirectURL.replace('{sessionId}', sid);
    } catch {}

      // Ensure IPNURL is a valid public HTTPS if not configured in settings
      try {
        const cfgIpn = String(settings?.payments?.icredit?.ipnURL || '').trim();
        if (cfgIpn) {
          overrides.IPNURL = cfgIpn;
        } else {
          const h = req.headers || {};
          const host = String(h['x-forwarded-host'] || h.host || '').trim();
          const proto = (String(h['x-forwarded-proto'] || '')).split(',')[0] || 'https';
          if (host) {
            const base = `${proto}://${host}`.replace(/\/$/, '');
            overrides.IPNURL = `${base}/api/payments/icredit/ipn`;
          }
        }
      } catch {}

    // Include client IP if available (some gateways require it)
    let clientIp = getClientIp(req) || getFallbackIpFromEnv();
    if (!clientIp) {
      const bodyIp = validateIPv4(req.body?.clientIp || req.body?.ip || req.body?.ipAddress);
      if (bodyIp) clientIp = bodyIp;
    }
    // Hard fallback to a safe IPv4 literal to satisfy gateways that require IPAddress
    if (!clientIp) {
      clientIp = '1.1.1.1';
    }
    // Diagnostic log to help field issues around IP resolution
    try {
      console.log('[payments][icredit][create-session-from-cart][ip]', {
        fromHeaders: getClientIp(req) || null,
        fromEnv: getFallbackIpFromEnv() || null,
        fromBody: validateIPv4(req.body?.clientIp || req.body?.ip || req.body?.ipAddress) || null,
        final: clientIp || null
      });
    } catch {}
    const overridesWithIp = clientIp ? { ...overrides, IPAddress: clientIp } : overrides;
    const { url } = await requestICreditPaymentUrl({ order: orderLike, settings, overrides: overridesWithIp });
    return res.json({ ok: true, url, sessionId: String(ps._id) });
  } catch (e) {
    try { console.error('[payments][icredit][create-session-from-cart] error', e?.message || e); } catch {}
    return res.status(400).json({ message: 'icredit_session_failed', detail: e?.message || String(e) });
  }
});

// Confirm a paid session (idempotent): create the Order now and return summary
router.post('/icredit/confirm', async (req, res) => {
  let redeemedGiftCardDoc = null;
  let redeemedGiftCardAmount = 0;
  let pendingOrderId = null;
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ message: 'sessionId required' });
    const ps = await PaymentSession.findById(sessionId);
    if (!ps) return res.status(404).json({ message: 'session_not_found' });
    if (ps.orderId) {
      const existing = await Order.findById(ps.orderId);
      if (existing) {
        return res.json({ ok: true, order: { _id: existing._id, orderNumber: existing.orderNumber, shippingFee: existing.shippingFee || existing.deliveryFee || 0 } });
      }
    }

    // Load product catalog prices and compute totals
    let totalAmount = 0;
    const orderItems = [];
    for (const item of ps.items) {
      const product = await Product.findById(item.product);
      if (!product) return res.status(404).json({ message: `Product not found: ${item.product}` });
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ message: 'invalid_quantity' });
      const catalogPrice = Number(product.price);
      if (!isFinite(catalogPrice)) return res.status(400).json({ message: `Invalid price for ${product._id}` });
      totalAmount += catalogPrice * qty;
      orderItems.push({
        product: product._id,
        quantity: qty,
        price: catalogPrice,
        name: product.name,
        image: Array.isArray(product.images) && product.images.length ? product.images[0] : undefined,
        size: item.variantId ? undefined : (item.size || undefined),
        color: item.color || undefined,
        variants: item.variants,
        variantId: item.variantId,
        sku: item.sku
      });
    }

    const couponInfo = (ps.coupon && ps.coupon.code)
      ? { code: ps.coupon.code, discount: Math.max(0, Number(ps.coupon.discount) || 0) }
      : undefined;
    if (couponInfo && couponInfo.discount > 0) {
      totalAmount = Math.max(0, totalAmount - couponInfo.discount);
    }

    // Trust client-provided shipping fee if configured to allow (default true in server)
    let shippingFee = Number(ps.shippingFee) || 0;
    if (!isFinite(shippingFee) || shippingFee < 0) shippingFee = 0;

    // Reserve/decrement inventory on order creation (post-payment)
    try {
      const reservationItems = orderItems.map(it => ({
        product: it.product,
        quantity: it.quantity,
        ...(it.variantId ? { variantId: it.variantId } : { size: it.size, color: it.color })
      }));
      await inventoryService.reserveItems(reservationItems, null, null);
    } catch (invErr) {
      console.warn('[payments][icredit][confirm] inventory reserve failed', invErr?.message || invErr);
    }

    pendingOrderId = new mongoose.Types.ObjectId();
    let giftCardSnapshot = undefined;
    if (ps.giftCard?.code && Number(ps.giftCard?.amount) > 0) {
      const redemption = await redeemGiftCardForSession({
        code: ps.giftCard.code,
        amount: Number(ps.giftCard.amount)
      }, pendingOrderId);
      redeemedGiftCardDoc = redemption.doc;
      redeemedGiftCardAmount = redemption.amountApplied;
      giftCardSnapshot = {
        code: redemption.doc.code,
        amountApplied: redemption.amountApplied,
        remainingBalance: redemption.remainingBalance
      };
    }

    // Create the order now
    const order = await Order.create({
      _id: pendingOrderId,
      items: orderItems,
      totalAmount,
      currency: ps.currency,
      exchangeRate: 1,
      shippingAddress: ps.shippingAddress,
      paymentMethod: 'card',
      customerInfo: ps.customerInfo,
      status: 'pending',
      orderNumber: `ORD${Date.now()}`,
      shippingFee,
      deliveryFee: shippingFee,
      paymentStatus: 'completed',
      coupon: couponInfo,
      giftCard: giftCardSnapshot
    });

    ps.status = 'confirmed';
    ps.orderId = order._id;
    await ps.save();

    return res.json({ ok: true, order: { _id: order._id, orderNumber: order.orderNumber, shippingFee: order.shippingFee || order.deliveryFee || 0 } });
  } catch (e) {
    if (redeemedGiftCardDoc && pendingOrderId && redeemedGiftCardAmount > 0) {
      await rollbackGiftCardRedemption(redeemedGiftCardDoc, pendingOrderId, redeemedGiftCardAmount);
    }
    try { console.error('[payments][icredit][confirm] error', e?.message || e); } catch {}
    return res.status(400).json({ message: 'confirm_failed', detail: e?.message || String(e) });
  }
});

async function redeemGiftCardForSession(payload, orderId) {
  const code = String(payload?.code || '').trim();
  const amount = Number(payload?.amount);
  if (!code || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid_gift_card_payload');
  }
  const giftCard = await GiftCard.findOne({ code });
  if (!giftCard) throw new Error('gift_card_not_found');
  const now = new Date();
  if (giftCard.expiryDate && giftCard.expiryDate < now) {
    throw new Error('gift_card_expired');
  }
  if (giftCard.status === 'cancelled') {
    throw new Error('gift_card_cancelled');
  }
  if (giftCard.currentBalance < amount) {
    throw new Error('gift_card_insufficient');
  }
  giftCard.currentBalance -= amount;
  giftCard.lastUsed = new Date();
  giftCard.redemptions.push({ order: orderId, amount });
  await giftCard.save();
  return { doc: giftCard, amountApplied: amount, remainingBalance: giftCard.currentBalance };
}

async function rollbackGiftCardRedemption(doc, orderId, amount) {
  try {
    doc.currentBalance += amount;
    if (Array.isArray(doc.redemptions)) {
      doc.redemptions = doc.redemptions.filter((entry) => {
        if (!entry?.order) return true;
        return String(entry.order) !== String(orderId);
      });
    }
    await doc.save();
  } catch (err) {
    try { console.error('[payments][icredit][confirm] gift card rollback failed', err?.message || err); } catch {}
  }
}

// Admin diagnostics: inspect runtime IP resolution and relevant env flags
router.get('/icredit/debug-runtime', adminAuth, (req, res) => {
  try {
    const fromHeaders = getClientIp(req) || null;
    const fromEnv = getFallbackIpFromEnv() || null;
    const fromQuery = validateIPv4(req.query?.ip || req.query?.clientIp || req.query?.ipAddress) || null;
    const trustProxy = req.app && req.app.get ? req.app.get('trust proxy') : undefined;
    const env = {
      ICREDIT_FORCE_TEST: String(process.env.ICREDIT_FORCE_TEST || ''),
      ICREDIT_TRANSPORT: String(process.env.ICREDIT_TRANSPORT || ''),
      ICREDIT_FORCE_IPV4: String(process.env.ICREDIT_FORCE_IPV4 || ''),
      ICREDIT_DEFAULT_IP: fromEnv ? fromEnv : ''
    };
    return res.json({ ok: true, trustProxy, ip: { fromHeaders, fromEnv, fromQuery } , env });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'debug_failed' });
  }
});
