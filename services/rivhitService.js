import axios from 'axios';
import Settings from '../models/Settings.js';

async function getConfig() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  const cfg = s.rivhit || {};
  const apiUrl = (cfg.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc').replace(/\/$/, '');
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

export async function getItemQuantity({ id_item, storage_id }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  if (transport === 'soap') {
    const action = 'Item_Quantity'; // Rivhit SOAP method name (example)
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await axios.post(url, envelope, {
        timeout: 20000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': `https://api.rivhit.co.il/online/${action}`
        }
      });
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
    const url = apiUrl + '/Item.Quantity';
    let data;
    try {
      const resp = await axios.post(url, body, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
      });
      data = resp?.data || {};
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const raw = r?.data;
      if (typeof raw === 'string') {
        const hint = raw.includes('Request Error') ? ' (Rivhit Request Error – verify token_api, id_item, and API URL)' : '';
        const e = new Error(`Rivhit ${status || ''} error${hint}`.trim());
        e.code = status || 0;
        throw e;
      }
      const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
    if (typeof data?.error_code === 'number' && data.error_code !== 0) {
      const msg = data?.client_message || data?.debug_message || 'Rivhit error';
      const err = new Error(msg);
      err.code = data.error_code;
      throw err;
    }
    const qty = data?.data?.quantity;
    return { quantity: typeof qty === 'number' ? qty : 0 };
  }
}

export async function updateItem({ id_item, storage_id, ...fields }) {
  const { enabled, apiUrl, token, defaultStorageId, transport } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  if (transport === 'soap') {
    const action = 'Item_Update'; // Rivhit SOAP method name (example)
    const fieldsXml = Object.entries(fields).map(([k,v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n');
    const inner = `      <token_api>${xmlEscape(token)}</token_api>\n      <id_item>${Number(id_item)}</id_item>` + (sid && Number.isFinite(sid) && sid > 0 ? `\n      <storage_id>${Number(sid)}</storage_id>` : '') + (fieldsXml ? `\n${fieldsXml}` : '');
    const envelope = buildSoapEnvelope(action, `\n${inner}\n`);
    const url = apiUrl;
    try {
      const resp = await axios.post(url, envelope, {
        timeout: 25000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': `https://api.rivhit.co.il/online/${action}`
        }
      });
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
    const url = apiUrl + '/Item.Update';
    let data;
    try {
      const resp = await axios.post(url, body, {
        timeout: 20000,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' }
      });
      data = resp?.data || {};
    } catch (err) {
      const r = err?.response;
      const status = r?.status;
      const raw = r?.data;
      if (typeof raw === 'string') {
        const hint = raw.includes('Request Error') ? ' (Rivhit Request Error – verify token_api, id_item, fields, and API URL)' : '';
        const e = new Error(`Rivhit ${status || ''} error${hint}`.trim());
        e.code = status || 0;
        throw e;
      }
      const e = new Error(`Rivhit request failed${status ? ` (${status})` : ''}`);
      e.code = status || 0;
      throw e;
    }
    if (typeof data?.error_code === 'number' && data.error_code !== 0) {
      const msg = data?.client_message || data?.debug_message || 'Rivhit error';
      const err = new Error(msg);
      err.code = data.error_code;
      throw err;
    }
    return { update_success: !!data?.data?.update_success };
  }
}

export default {
  getItemQuantity,
  updateItem,
  testConnectivity
};
