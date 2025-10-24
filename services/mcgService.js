import axios from 'axios';
import Settings from '../models/Settings.js';

// In-memory token cache
let tokenCache = {
  accessToken: '',
  expiresAt: 0 // epoch ms
};

function now() { return Date.now(); }

async function getConfig() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  const db = s.mcg || {};
  const apiFlavor = (db.apiFlavor || process.env.MCG_API_FLAVOR || '').trim().toLowerCase();

  // Base URL defaults differ by flavor
  let base = (db.baseUrl || process.env.MCG_BASE_URL || '').trim();
  if (!base) {
    base = apiFlavor === 'uplicali'
      ? 'https://apis.uplicali.com/SuperMCG/MCG_API'
      : 'https://api.mcgateway.com';
  }
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base; // ensure protocol
  base = base.replace(/\/$/, '');

  const clientId = (db.clientId || process.env.MCG_CLIENT_ID || '').trim();
  const clientSecret = (db.clientSecret || process.env.MCG_CLIENT_SECRET || '').trim();
  const scope = (db.scope || process.env.MCG_SCOPE || '').trim();
  const version = (db.apiVersion || process.env.MCG_API_VERSION || 'v2.6').trim();
  const tokenUrl = (db.tokenUrl || process.env.MCG_TOKEN_URL || (apiFlavor === 'uplicali' ? 'https://login.uplicali.com/mcg' : '')).trim();
  const extraHeaderName = (db.extraHeaderName || process.env.MCG_EXTRA_HEADER_NAME || '').trim();
  const extraHeaderValue = (db.extraHeaderValue || process.env.MCG_EXTRA_HEADER_VALUE || '').trim();
  const vendorCode = (db.vendorCode || process.env.MCG_VENDOR_CODE || '').trim();
  const retailerKey = (db.retailerKey || process.env.MCG_RETAILER_KEY || '').trim();
  const retailerClientId = (db.retailerClientId || process.env.MCG_RETAILER_CLIENT_ID || '').trim();
  const enabled = typeof db.enabled === 'boolean' ? !!db.enabled : !!(clientId && clientSecret);
  if (!clientId || !clientSecret) {
    throw new Error('MCG client credentials are not configured (Settings.mcg or env)');
  }
  return { base, clientId, clientSecret, scope, version, enabled, tokenUrl, extraHeaderName, extraHeaderValue, apiFlavor, vendorCode, retailerKey, retailerClientId };
}

async function fetchAccessToken() {
  const { clientId, clientSecret, scope, tokenUrl, base, apiFlavor } = await getConfig();
  const url = tokenUrl || (apiFlavor === 'uplicali' ? 'https://login.uplicali.com/mcg' : `${base}/oauth2/access_token`);
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (scope) params.set('scope', scope);
  const resp = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });
  const data = resp?.data || {};
  const token = data.access_token || data.token || '';
  const expiresIn = Number(data.expires_in || 0);
  if (!token) throw new Error('MCG OAuth2 did not return access_token');
  const ttl = Number.isFinite(expiresIn) && expiresIn > 60 ? (expiresIn - 60) * 1000 : 10 * 60 * 1000;
  tokenCache = { accessToken: token, expiresAt: now() + ttl };
  return token;
}

async function getAccessToken() {
  if (tokenCache.accessToken && tokenCache.expiresAt - now() > 10 * 1000) {
    return tokenCache.accessToken;
  }
  return await fetchAccessToken();
}

function buildAuthHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// Flavor detection
function isUpliFlavor(cfg) {
  return (cfg.apiFlavor === 'uplicali') || /apis\.uplicali\.com/i.test(cfg.base) || /SuperMCG\/MCG_API/i.test(cfg.base);
}

function buildUpliUrl(base, vendorCode, retailerKey, retailerClientId) {
  const q = new URLSearchParams({ code: vendorCode, key: retailerKey, client_id: retailerClientId });
  return `${base}?${q.toString()}`;
}

async function mcgRequestUpli(body) {
  const cfg = await getConfig();
  const { base, vendorCode, retailerKey, retailerClientId } = cfg;
  if (!vendorCode || !retailerKey || !retailerClientId) {
    throw new Error('MCG Uplîcali identifiers are missing: vendorCode, retailerKey, retailerClientId');
  }
  const url = buildUpliUrl(base, vendorCode, retailerKey, retailerClientId);
  let token = await getAccessToken();
  try {
    const resp = await axios.post(url, body, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...buildAuthHeader(token),
        code: vendorCode,
        key: retailerKey,
        client_id: retailerClientId
      },
      timeout: 25000
    });
    return resp?.data || {};
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...buildAuthHeader(token),
          code: vendorCode,
          key: retailerKey,
          client_id: retailerClientId
        },
        timeout: 25000
      });
      return resp2?.data || {};
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        const m = d.Message || d.error || d.message;
        if (m) detail = `: ${m}`;
      } else if (typeof e?.response?.data === 'string') {
        detail = `: ${String(e.response.data).slice(0,160).replace(/\s+/g,' ').trim()}`;
      }
    } catch {}
    if (!detail && e && e.message) detail = `: ${e.message}`;
    const err = new Error(`MCG request failed${status ? ` (${status})` : ''}${detail}`);
    err.status = status;
    throw err;
  }
}

export async function getVersion() {
  const cfg = await getConfig();
  if (!isUpliFlavor(cfg)) throw new Error('getVersion is only available for Uplîcali flavor');
  return await mcgRequestUpli({ req: 'get_ver' });
}

// Build body for legacy list
function buildItemsListBody({ PageNumber, PageSize, Filter }) {
  const body = {};
  if (Number.isFinite(Number(PageNumber)) && Number(PageNumber) > 0) body.PageNumber = Number(PageNumber);
  if (Number.isFinite(Number(PageSize)) && Number(PageSize) > 0) body.PageSize = Number(PageSize);
  if (Filter && typeof Filter === 'object') {
    const f = {};
    const map = ['Category','Manufacturer','Barcode','ItemID','SearchText','AvailableOnly'];
    for (const k of map) {
      if (Object.prototype.hasOwnProperty.call(Filter, k)) f[k] = Filter[k];
    }
    if (Object.keys(f).length) body.Filter = f;
  }
  return body;
}

export async function getItemsList(params = {}) {
  const cfg = await getConfig();
  if (isUpliFlavor(cfg)) {
    const { start_time, startTime, group } = params || {};
    const body = { req: 'get_items_list' };
    if (startTime || start_time) body.start_time = (startTime || start_time);
    if (group !== undefined && group !== null && !Number.isNaN(Number(group))) body.group = Number(group);
    return await mcgRequestUpli(body);
  }

  const { base, version, extraHeaderName, extraHeaderValue } = cfg;
  const url = `${base}/api/${version}/get_items_list`;
  let token = await getAccessToken();
  const body = buildItemsListBody(params);
  try {
    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
      timeout: 25000
    });
    return resp?.data || {};
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token), ...(extraHeaderName && extraHeaderValue ? { [extraHeaderName]: extraHeaderValue } : {}) },
        timeout: 25000
      });
      return resp2?.data || {};
    }
    let detail = '';
    try {
      const d = e?.response?.data;
      if (d && typeof d === 'object') {
        const m = d.Message || d.error || d.message;
        if (m) detail = `: ${m}`;
      } else if (typeof e?.response?.data === 'string') {
        detail = `: ${String(e.response.data).slice(0,160).replace(/\s+/g,' ').trim()}`;
      }
    } catch {}
    if (!detail && e && e.message) {
      detail = `: ${e.message}`;
    }
    const err = new Error(`MCG get_items_list failed${status ? ` (${status})` : ''}${detail}`);
    err.status = status;
    throw err;
  }
}

export default { getItemsList, getVersion };
