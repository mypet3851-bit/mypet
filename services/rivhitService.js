import axios from 'axios';
import Settings from '../models/Settings.js';

// Normalize and sanitize base URL to Rivhit .svc endpoint (avoid double-method segments)
function normalizeApiBase(u) {
  let url = String(u || '').trim();
  if (!url) url = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc';
  // remove whitespace and trailing slashes
  url = url.replace(/\s+/g, '').replace(/\/+$/, '');
  // strip accidental method segments or /JSON suffixes added by mistake
  url = url.replace(/\/(JSON|SOAP)\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  url = url.replace(/\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  // ensure ends with .svc
  if (!/\.svc$/i.test(url)) {
    if (/\/online$/i.test(url)) url += '/RivhitOnlineAPI.svc';
    else if (/rivhit\.co\.il\/online/i.test(url)) url += '/RivhitOnlineAPI.svc';
    else url += '/RivhitOnlineAPI.svc';
  }
  return url;
}

async function getConfig() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  const cfg = s.rivhit || {};
  const apiUrl = normalizeApiBase(cfg.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc');
  const token = cfg.tokenApi || process.env.RIVHIT_TOKEN || '';
  const defaultStorageId = Number(cfg.defaultStorageId || 0) || 0;
  const transport = cfg.transport === 'soap' ? 'soap' : 'json';
  return { enabled: !!cfg.enabled, apiUrl, token, defaultStorageId, transport };
}

export async function testConnectivity() {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (!token) return { ok: false, reason: 'missing_token' };
  try {
    // Lightweight OPTIONS/HEAD as a smoke (not all servers accept, fall back to POST with bogus id)
    await axios.options(apiUrl + '/Item.Quantity').catch(() => null);
  } catch {}
  return { ok: true };
}

export async function getLastRequest(format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = apiUrl + `/Status.LastRequest/${format}`;
  const resp = await axios.post(url, { token_api: token }, { timeout: 15000, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' } });
  return resp?.data || {};
}

export async function getErrorMessage(code, format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = apiUrl + `/Status.ErrorMessage`;
  const body = { token_api: token, error_code: Number(code) };
  const resp = await axios.post(url, body, { timeout: 15000, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' } });
  return resp?.data || {};
}

// --- SOAP helpers ---
function buildSoapEnvelope(action, bodyXml) {
  return `<?xml version="1.0" encoding="utf-8"?>\n`+
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n`+
    `  <soap:Body>\n`+
    `    <${action} xmlns="https://api.rivhit.co.il/online/">\n`+
    bodyXml +
    `    </${action}>\n`+
    `  </soap:Body>\n`+
    `</soap:Envelope>`;
}

function xmlEscape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function parseSoapQuantity(xml) {
  // Minimal extraction of <quantity>...</quantity> value
  const m = xml && String(xml).match(/<quantity>([-\d\.]+)<\/quantity>/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function maskToken(t) {
  if (!t) return '';
  const str = String(t);
  if (str.length <= 6) return '***';
  return str.slice(0,3) + '***' + str.slice(-3);
}

function looksLikeHtmlError(resp) {
  try {
    const ct = resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'];
    if (ct && /text\/html/i.test(String(ct))) return true;
    const body = resp?.data;
    if (typeof body === 'string') {
      const s = body;
      return /<html|Request Error|The incoming message has an unexpected message format/i.test(s);
    }
  } catch {}
  return false;
}

function buildJsonMethodCandidates(base, method) {
  const b = base.replace(/\/$/, '');
  const noSvc = b.replace(/RivhitOnlineAPI\.svc$/i, '');
  // Try standard, JSON subpath, and service-root variants
  return [
    `${b}/${method}`,
    `${b}/JSON/${method}`,
    `${noSvc}/JSON/${method}`,
    `${noSvc}/${method}`
  ].filter((v, i, a) => a.indexOf(v) === i);
}

async function postSoap(apiUrl, action, envelope, timeoutMs = 20000) {
  const headersList = [
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `https://api.rivhit.co.il/online/${action}` },
    { 'Content-Type': 'text/xml; charset=utf-8' },
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `http://tempuri.org/IRivhitOnlineAPI/${action}` }
  ];
  let lastErr = null;
  for (let i = 0; i < headersList.length; i++) {
    try {
      const resp = await axios.post(apiUrl, envelope, { timeout: timeoutMs, headers: headersList[i] });
      return resp;
    } catch (e) {
      lastErr = e;
      // try next header variant
    }
  }
  throw lastErr || new Error('SOAP request failed');
}

export async function getItemQuantity({ id_item, storage_id }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const nItem = Number(id_item);
  if (!Number.isFinite(nItem) || nItem <= 0) {
    const e = new Error('Invalid id_item (must be a positive number)');
    e.code = 400; throw e;
  }
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  try {
    // Minimal debug to server logs without revealing token
    console.log('[rivhit][getItemQuantity] transport=%s url=%s id_item=%s storage_id=%s token=%s', transport, apiUrl, nItem, (sid||0), maskToken(token));
  } catch {}
  if (transport === 'soap') {
    const action = 'Item_Quantity'; // Rivhit SOAP method name (example)
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await postSoap(url, action, envelope, 20000);
      const xml = resp?.data || '';
      const quantity = parseSoapQuantity(xml);
      return { quantity };
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const e = new Error(`Rivhit SOAP request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
  } else {
    const body = { token_api: token, id_item };
    if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;
    const candidates = buildJsonMethodCandidates(apiUrl, 'Item.Quantity');
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const resp = await axios.post(url, body, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
        });
        const data = resp?.data || {};
        if (typeof data?.error_code === 'number' && data.error_code !== 0) {
          const msg = data?.client_message || data?.debug_message || 'Rivhit error';
          const err = new Error(msg);
          err.code = data.error_code;
          throw err;
        }
        const qty = data?.data?.quantity;
        return { quantity: typeof qty === 'number' ? qty : 0 };
      } catch (err) {
        const r = err?.response;
        const status = r?.status;
        const isHtml = looksLikeHtmlError(r);
        lastErr = err;
        if (isHtml) {
          // Try next JSON variant; if none left, fall back to SOAP
          if (i < candidates.length - 1) {
            console.warn(`[rivhit] JSON call returned HTML at %s; trying next variant (%d/%d)`, url, i + 2, candidates.length);
            continue;
          }
          try {
            console.warn('[rivhit] JSON call returned HTML on all variants; attempting SOAP fallback');
            const action = 'Item_Quantity';
            const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${nItem}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '');
            const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
            const resp2 = await postSoap(apiUrl, action, envelope, 20000);
            const xml = resp2?.data || '';
            const quantity = parseSoapQuantity(xml);
            return { quantity };
          } catch (soapErr) {
            const e2 = new Error('Rivhit 400 error (Request Error – JSON and SOAP both failed)');
            e2.code = 400; throw e2;
          }
        }
        // Non-HTML error: bubble with hint
        const hint = ' (verify token_api, id_item, storage_id and API URL)';
        const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}${hint}`);
        e.code = status || 0;
        throw e;
      }
    }
    // Should not reach here; throw last error
    throw lastErr || new Error('Rivhit request failed');
  }
}

export async function updateItem({ id_item, storage_id, ...fields }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const nItem = Number(id_item);
  if (!Number.isFinite(nItem) || nItem <= 0) { const e = new Error('Invalid id_item (must be a positive number)'); e.code = 400; throw e; }
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  try {
    console.log('[rivhit][updateItem] transport=%s url=%s id_item=%s storage_id=%s token=%s fields=%s', transport, apiUrl, nItem, (sid||0), maskToken(token), Object.keys(fields||{}).join(','));
  } catch {}
  if (transport === 'soap') {
    const action = 'Item_Update'; // Rivhit SOAP method name (example)
    const fieldsXml = Object.entries(fields).map(([k,v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n');
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await postSoap(url, action, envelope, 25000);
      const xml = resp?.data || '';
      // Consider any 200 a success unless explicit fault detected
      if (/<faultstring>/i.test(String(xml))) {
        const m = String(xml).match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
        const msg = m ? m[1] : 'Rivhit SOAP fault';
        const e = new Error(msg);
        e.code = 0;
        throw e;
      }
      return { update_success: true };
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const e = new Error(`Rivhit SOAP request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
  } else {
    const body = { token_api: token, id_item, ...fields };
    if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;
    const candidates = buildJsonMethodCandidates(apiUrl, 'Item.Update');
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const resp = await axios.post(url, body, {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
        });
        const data = resp?.data || {};
        if (typeof data?.error_code === 'number' && data.error_code !== 0) {
          const msg = data?.client_message || data?.debug_message || 'Rivhit error';
          const err = new Error(msg);
          err.code = data.error_code;
          throw err;
        }
        return { update_success: !!data?.data?.update_success };
      } catch (err) {
        const r = err?.response;
        const status = r?.status;
        const isHtml = looksLikeHtmlError(r);
        lastErr = err;
        if (isHtml) {
          if (i < candidates.length - 1) {
            console.warn(`[rivhit] JSON update returned HTML at %s; trying next variant (%d/%d)`, url, i + 2, candidates.length);
            continue;
          }
          try {
            console.warn('[rivhit] JSON update returned HTML on all variants; attempting SOAP fallback');
            const action = 'Item_Update';
            const fieldsXml = Object.entries(fields).map(([k,v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n');
            const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${nItem}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
            const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
            await postSoap(apiUrl, action, envelope, 25000);
            return { update_success: true };
          } catch (soapErr) {
            const e2 = new Error('Rivhit 400 error (Request Error – JSON and SOAP both failed)'); e2.code = 400; throw e2;
          }
        }
        const hint = ' (verify token_api, id_item, fields and API URL)';
        const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}${hint}`);
        e.code = status || 0;
        throw e;
      }
    }
    throw lastErr || new Error('Rivhit request failed');
  }
}

export default {
  getItemQuantity,
  updateItem,
  testConnectivity,
  getLastRequest,
  getErrorMessage
};
