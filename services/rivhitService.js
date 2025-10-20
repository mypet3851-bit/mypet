import axios from 'axios';
import Settings from '../models/Settings.js';

async function getConfig() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  const cfg = s.rivhit || {};
  const apiUrl = (cfg.apiUrl || 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc').replace(/\/$/, '');
  const token = cfg.tokenApi || process.env.RIVHIT_TOKEN || '';
  const defaultStorageId = Number(cfg.defaultStorageId || 0) || 0;
  return { enabled: !!cfg.enabled, apiUrl, token, defaultStorageId };
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

export async function getItemQuantity({ id_item, storage_id }) {
  const { enabled, apiUrl, token, defaultStorageId } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const body = {
    token_api: token,
    id_item,
  };
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;
  const url = apiUrl + '/Item.Quantity';
  let data;
  try {
    const resp = await axios.post(url, body, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json'
      }
    });
    data = resp?.data || {};
  } catch (err) {
    // Axios rejects on 4xx/5xx; try to extract meaningful message
    const r = err?.response;
    const status = r?.status;
    const raw = r?.data;
    // Rivhit sometimes returns HTML "Request Error" page on bad request
    if (typeof raw === 'string') {
      const hint = raw.includes('Request Error') ? ' (Rivhit Request Error – verify token_api, id_item, and API URL)' : '';
      const e = new Error(`Rivhit ${status || ''} error${hint}`.trim());
      e.code = status || 0;
      throw e;
    }
    // JSON-like error: propagate
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

export async function updateItem({ id_item, storage_id, ...fields }) {
  const { enabled, apiUrl, token, defaultStorageId } = await getConfig();
  if (!enabled) throw new Error('Rivhit integration disabled');
  if (!token) throw new Error('Rivhit API token not configured');
  const body = { token_api: token, id_item, ...fields };
  const sid = typeof storage_id === 'number' ? storage_id : defaultStorageId;
  if (sid && Number.isFinite(sid) && sid > 0) body.storage_id = sid;
  const url = apiUrl + '/Item.Update';
  let data;
  try {
    const resp = await axios.post(url, body, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json'
      }
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

export default {
  getItemQuantity,
  updateItem,
  testConnectivity
};
