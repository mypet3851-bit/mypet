import axios from 'axios';
import Settings from '../models/Settings.js';

// Normalize and sanitize base URL to Rivhit .svc endpoint
function normalizeApiBase(u) {
  let url = String(u || '').trim().replace(/\s+/g, '').replace(/\/+$/, '');
  url = url.replace(/\/(JSON|SOAP)\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  url = url.replace(/\/(Item\.[A-Za-z]+|Status\.[A-Za-z]+|[A-Za-z_]+)$/i, '');
  if (!/\.svc$/i.test(url)) {
    url += '/RivhitOnlineAPI.svc';
  }
  return url;
}

async function getConfig() {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  const cfg = settings.rivhit || {};
  return {
    enabled: !!cfg.enabled,
    apiUrl: normalizeApiBase(cfg.apiUrl),
    token: cfg.tokenApi || process.env.RIVHIT_TOKEN || '',
    defaultStorageId: Number(cfg.defaultStorageId || 0),
    transport: cfg.transport === 'soap' ? 'soap' : 'json',
  };
}

export async function testConnectivity() {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (!token) return { ok: false, reason: 'missing_token' };
  try {
    await axios.options(`${apiUrl}/Item.Quantity`).catch(() => null);
  } catch {}
  return { ok: true };
}

export async function getLastRequest(format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = `${apiUrl}/Status.LastRequest/${format}`;
  const resp = await axios.post(url, { token_api: token }, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
  });
  return resp?.data || {};
}

export async function getErrorMessage(code, format = 'json') {
  const { enabled, apiUrl, token } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const url = `${apiUrl}/Status.ErrorMessage`;
  const resp = await axios.post(url, { token_api: token, error_code: Number(code) }, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
  });
  return resp?.data || {};
}

// --- SOAP Helpers ---
function buildSoapEnvelope(action, bodyXml) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${action} xmlns="https://api.rivhit.co.il/online/">
${bodyXml}
    </${action}>
  </soap:Body>
</soap:Envelope>`;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseSoapQuantity(xml) {
  const m = xml && String(xml).match(/<quantity>([-\d.]+)<\/quantity>/i);
  return m ? Number(m[1]) || 0 : 0;
}

function maskToken(t) {
  if (!t) return '';
  const str = String(t);
  return str.length <= 6 ? '***' : `${str.slice(0,3)}***${str.slice(-3)}`;
}

function looksLikeHtmlError(resp) {
  try {
    const ct = resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'];
    if (ct && /text\/html/i.test(String(ct))) return true;
    const body = resp?.data;
    if (typeof body === 'string') {
      return /<html|Request Error|The incoming message has an unexpected message format/i.test(body);
    }
  } catch {}
  return false;
}

function buildJsonMethodCandidates(base, method) {
  const b = base.replace(/\/$/, '');
  const noSvc = b.replace(/RivhitOnlineAPI\.svc$/i, '');
  return [...new Set([`${b}/${method}`, `${b}/JSON/${method}`, `${noSvc}/JSON/${method}`, `${noSvc}/${method}`])];
}

async function postSoap(apiUrl, action, envelope, timeoutMs = 20000) {
  const headersList = [
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `https://api.rivhit.co.il/online/${action}` },
    { 'Content-Type': 'text/xml; charset=utf-8' },
    { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `http://tempuri.org/IRivhitOnlineAPI/${action}` }
  ];
  let lastErr = null;
  for (const headers of headersList) {
    try {
      const resp = await axios.post(apiUrl, envelope, { timeout: timeoutMs, headers });
      return resp;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('SOAP request failed');
}

// --- Item Operations ---
export async function getItemQuantity({ id_item, storage_id }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');

  const nItem = Number(id_item);
  if (!Number.isFinite(nItem) || nItem <= 0) throw Object.assign(new Error('Invalid id_item'), { code: 400 });

  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  console.log('[rivhit][getItemQuantity]', { transport, apiUrl, nItem, storage_id: sid, token: maskToken(token) });

  if (transport === 'soap') {
    const action = 'Item_Quantity';
    const inner = `<token_api>${xmlEscape(token)}</token_api>\n<id_item>${nItem}</id_item>` +
                  (sid ? `\n<storage_id>${sid}</storage_id>` : '');
    const envelope = buildSoapEnvelope(action, inner);
    try {
      const resp = await postSoap(apiUrl, action, envelope);
      return { quantity: parseSoapQuantity(resp?.data) };
    } catch (err) {
      throw Object.assign(new Error(`Rivhit SOAP request failed (${err?.response?.status || 0})`), { code: err?.response?.status || 0 });
    }
  }

  const body = { token_api: token, id_item: nItem };
  if (sid) body.storage_id = sid;
  const candidates = buildJsonMethodCandidates(apiUrl, 'Item.Quantity');

  let lastErr = null;
  for (const url of candidates) {
    try {
      const resp = await axios.post(url, body, { timeout: 15000, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
      const data = resp?.data || {};
      if (data?.error_code) throw Object.assign(new Error(data?.client_message || 'Rivhit error'), { code: data.error_code });
      return { quantity: data?.data?.quantity || 0 };
    } catch (err) {
      lastErr = err;
      if (looksLikeHtmlError(err?.response)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Rivhit request failed');
}

export async function updateItem({ id_item, storage_id, ...fields }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');

  const nItem = Number(id_item);
  if (!Number.isFinite(nItem) || nItem <= 0) throw Object.assign(new Error('Invalid id_item'), { code: 400 });

  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  console.log('[rivhit][updateItem]', { transport, apiUrl, nItem, storage_id: sid, token: maskToken(token), fields: Object.keys(fields) });

  if (transport === 'soap') {
    const action = 'Item_Update';
    const fieldsXml = Object.entries(fields).map(([k,v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('\n');
    const inner = `<token_api>${xmlEscape(token)}</token_api>\n<id_item>${nItem}</id_item>` + (sid ? `\n<storage_id>${sid}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
    const envelope = buildSoapEnvelope(action, inner);
    try {
      const resp = await postSoap(apiUrl, action, envelope);
      if (/<faultstring>/i.test(resp?.data)) throw new Error('Rivhit SOAP fault');
      return { update_success: true };
    } catch (err) {
      throw Object.assign(new Error(`Rivhit SOAP request failed (${err?.response?.status || 0})`), { code: err?.response?.status || 0 });
    }
  }

  const body = { token_api: token, id_item: nItem, ...fields };
  if (sid) body.storage_id = sid;
  const candidates = buildJsonMethodCandidates(apiUrl, 'Item.Update');

  let lastErr = null;
  for (const url of candidates) {
    try {
      const resp = await axios.post(url, body, { timeout: 20000, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
      const data = resp?.data || {};
      if (data?.error_code) throw Object.assign(new Error(data?.client_message || 'Rivhit error'), { code: data.error_code });
      return { update_success: !!data?.data?.update_success };
    } catch (err) {
      lastErr = err;
      if (looksLikeHtmlError(err?.response)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Rivhit request failed');
}

export default {
  getItemQuantity,
  updateItem,
  testConnectivity,
  getLastRequest,
  getErrorMessage
};
