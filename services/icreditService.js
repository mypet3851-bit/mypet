import Settings from '../models/Settings.js';
import fetch from 'node-fetch';

// Build SOAP envelope for iCredit PaymentPageRequest.GetUrl
function buildSoapEnvelope(action, innerXml) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    `<${action} xmlns="https://icredit.rivhit.co.il/API/">` +
    innerXml +
    `</${action}>` +
    '</soap:Body>' +
    '</soap:Envelope>'
  );
}

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function maskToken(s) {
  if (!s) return '';
  const t = String(s);
  if (t.length <= 6) return '***';
  return t.slice(0, 3) + '***' + t.slice(-3);
}

// Generate likely API URL variants for JSON and SOAP
function buildICreditCandidates(apiUrl) {
  const u = String(apiUrl || '').trim().replace(/\s+/g, '');
  const list = new Set();
  const push = (v) => { if (v) list.add(v.replace(/\s+/g, '')); };
  // Base as configured
  push(u);
  // If exact GetUrl path, try adding /JSON segment
  push(u.replace(/\/GetUrl$/i, '/JSON/GetUrl'));
  // Insert /JSON after API
  push(u.replace(/\/API\//i, '/API/JSON/'));
  // Lowercase json variant used by some deployments
  push(u.replace(/\/GetUrl$/i, '/json/GetUrl'));
  // If missing GetUrl (base ends with PaymentPageRequest.svc), append both
  if (/PaymentPageRequest\.svc$/i.test(u)) {
    push(u + '/GetUrl');
    push(u + '/JSON/GetUrl');
  }
  // Alternate host variations that sometimes work
  push(u.replace('https://icredit.rivhit.co.il/', 'https://online.rivhit.co.il/'));
  push(u.replace('https://online.rivhit.co.il/', 'https://icredit.rivhit.co.il/'));
  return Array.from(list);
}

export function buildICreditRequest({ order, settings, overrides = {} }) {
  if (!order) throw new Error('order_required');
  const s = settings || {};
  const pay = s.payments || {};
  const ic = pay.icredit || {};
  if (!ic.groupPrivateToken) {
    throw new Error('Missing GroupPrivateToken in settings');
  }

  const val = (v, def) => (typeof v === 'undefined' || v === null ? def : v);

  const items = (order.items || []).map((it) => ({
    Id: 0,
    CatalogNumber: it.sku || it.variantId || String(it.product),
    UnitPrice: Number(it.price) || 0,
    Quantity: Number(it.quantity) || 0,
    Description: it.name || ''
  }));

  const body = {
    GroupPrivateToken: ic.groupPrivateToken,
    Items: items,
    RedirectURL: val(overrides.RedirectURL, ic.redirectURL || ''),
    IPNURL: val(overrides.IPNURL, ic.ipnURL || ''),
    ExemptVAT: val(overrides.ExemptVAT, !!ic.exemptVAT),
    MaxPayments: val(overrides.MaxPayments, ic.maxPayments || 1),
    CreditFromPayment: val(overrides.CreditFromPayment, ic.creditFromPayment || 0),
    EmailAddress: order.customerInfo?.email || '',
    CustomerLastName: order.customerInfo?.lastName || '',
    CustomerFirstName: order.customerInfo?.firstName || '',
    Address: order.shippingAddress?.street || '',
    City: order.shippingAddress?.city || '',
    Zipcode: overrides.Zipcode || '',
    PhoneNumber: order.customerInfo?.mobile || '',
    PhoneNumber2: '',
    FaxNumber: '',
    IdNumber: overrides.IdNumber || '',
    VatNumber: overrides.VatNumber || '',
    Comments: overrides.Comments || `Order ${order.orderNumber}`,
    HideItemList: val(overrides.HideItemList, !!ic.hideItemList),
    DocumentLanguage: val(overrides.DocumentLanguage, ic.documentLanguage || 'he'),
    CreateToken: val(overrides.CreateToken, !!ic.createToken),
    Discount: val(overrides.Discount, Number(ic.defaultDiscount || 0)),
    Custom1: overrides.Custom1 || order._id?.toString(),
    Custom2: overrides.Custom2 || '',
    Custom3: overrides.Custom3 || '',
    Custom4: overrides.Custom4 || '',
    Custom5: overrides.Custom5 || '',
    Custom6: overrides.Custom6 || '',
    Custom7: overrides.Custom7 || '',
    Custom8: overrides.Custom8 || '',
    Custom9: overrides.Custom9 || '',
    Reference: overrides.Reference || order.orderNumber,
    Order: overrides.Order || `Ecommerce order ${order.orderNumber}`,
    EmailBcc: val(overrides.EmailBcc, ic.emailBcc || ''),
    CustomerId: overrides.CustomerId || '',
    AgentId: overrides.AgentId || 0,
    ProjectId: overrides.ProjectId || 0
  };

  // Remove empty fields to keep payload tidy
  const clean = Object.fromEntries(Object.entries(body).filter(([_, v]) => v !== '' && v !== null && typeof v !== 'undefined'));
  return clean;
}

export async function loadSettings() {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
}

// Attempt to create an iCredit hosted payment session and return the redirect URL.
// Tries multiple JSON path variants and finally SOAP when JSON endpoints return HTML Request Error.
export async function requestICreditPaymentUrl({ order, settings, overrides = {} }) {
  const cfg = settings?.payments?.icredit || {};
  if (!cfg?.enabled) throw new Error('icredit_disabled');
  if (!cfg?.groupPrivateToken) throw new Error('missing_token');
  const apiUrl = cfg.apiUrl || 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl';
  const payload = buildICreditRequest({ order, settings, overrides });

  // Build wrappers expected by some WCF JSON endpoints
  const wrappers = [
    (b) => b, // plain object
    (b) => ({ request: b }), // wrapped in { request: ... }
    (b) => ({ Request: b }) // PascalCase wrapper just in case
  ];

  const candidates = buildICreditCandidates(apiUrl);
  let lastErr = null;

  // Try JSON candidates
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    for (let w = 0; w < wrappers.length; w++) {
      const bodyWrapped = wrappers[w](payload);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' },
          body: JSON.stringify(bodyWrapped)
        });
        const text = await r.text();
        // Some deployments return JSON with { Url: '...' }, others plain URL in body
        let urlOut = '';
        if (/application\/json/i.test(r.headers.get('content-type') || '')) {
          try {
            const j = JSON.parse(text);
            urlOut = j?.Url || j?.url || j?.PaymentUrl || '';
          } catch {
            // fall back below
          }
        }
        if (!urlOut && /^https?:\/\//i.test(text.trim())) {
          urlOut = text.trim();
        }
        if (r.ok && urlOut) {
          try { console.log('[icredit] JSON success via %s wrapper=%d token=%s', url, w + 1, maskToken(cfg.groupPrivateToken)); } catch {}
          return { url: urlOut };
        }
        // If HTML "Request Error" page, try next variant
        const isHtml = /<html|Request Error/i.test(text) || /text\/html/i.test(r.headers.get('content-type') || '');
        if (isHtml) {
          try { console.warn('[icredit] HTML response at %s wrapper=%d; trying next variant', url, w + 1); } catch {}
          continue;
        }
        // Non-HTML error — capture a snippet and continue trying variants
        lastErr = new Error(`HTTP ${r.status} ${r.statusText} at ${url}: ${text.slice(0, 180).replace(/\s+/g,' ')}`);
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
  }

  // SOAP fallback
  try {
    const action = 'GetUrl';
    const inner =
      '<request>' +
      Object.entries(payload)
        .map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`)
        .join('') +
      '</request>';
    const envelope = buildSoapEnvelope(action, inner);
    // Use base without /JSON and without trailing /GetUrl
    const soapEndpoint = apiUrl.replace(/\/JSON\//i, '/').replace(/\/GetUrl$/i, '');
    const r = await fetch(soapEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'https://icredit.rivhit.co.il/API/GetUrl' },
      body: envelope
    });
    const xml = await r.text();
    // Minimal extraction of <GetUrlResult>http...<\/GetUrlResult>
    const m = xml.match(/<GetUrlResult>(https?:[^<]+)<\/GetUrlResult>/i);
    if (r.ok && m && m[1]) {
      try { console.log('[icredit] SOAP success via %s', soapEndpoint); } catch {}
      return { url: m[1] };
    }
    lastErr = new Error(`SOAP failed ${r.status}: ${xml.slice(0, 200).replace(/\s+/g,' ')}`);
  } catch (e) {
    lastErr = e;
  }

  const err = new Error(`icredit_call_failed${lastErr ? ': ' + (lastErr.message || lastErr) : ''}`);
  err.status = 400;
  throw err;
}
