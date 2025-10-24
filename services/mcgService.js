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
  const base = (db.baseUrl || process.env.MCG_BASE_URL || 'https://api.mcgateway.com').trim().replace(/\/$/, '');
  const clientId = (db.clientId || process.env.MCG_CLIENT_ID || '').trim();
  const clientSecret = (db.clientSecret || process.env.MCG_CLIENT_SECRET || '').trim();
  const scope = (db.scope || process.env.MCG_SCOPE || '').trim();
  const version = (db.apiVersion || process.env.MCG_API_VERSION || 'v2.6').trim();
  const enabled = typeof db.enabled === 'boolean' ? !!db.enabled : !!(clientId && clientSecret);
  if (!clientId || !clientSecret) {
    throw new Error('MCG client credentials are not configured (Settings.mcg or env)');
  }
  return { base, clientId, clientSecret, scope, version, enabled };
}

async function fetchAccessToken() {
  const { base, clientId, clientSecret, scope } = getConfig();
  const url = `${base}/oauth2/access_token`;
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (scope) params.set('scope', scope);
  const resp = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  const data = resp?.data || {};
  const token = data.access_token || data.token || '';
  const expiresIn = Number(data.expires_in || 0);
  if (!token) throw new Error('MCG OAuth2 did not return access_token');
  // refresh 60s before actual expiry, default to 10 minutes if missing
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

// Normalize request body to the upstream MCG expected format
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

export async function getItemsList({ PageNumber, PageSize, Filter } = {}) {
  const { base, version } = await getConfig();
  const url = `${base}/api/${version}/get_items_list`;
  let token = await getAccessToken();
  const body = buildItemsListBody({ PageNumber, PageSize, Filter });
  try {
    const resp = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token) },
      timeout: 25000
    });
    return resp?.data || {};
  } catch (e) {
    // If unauthorized, try to refresh token once
    const status = e?.response?.status;
    if (status === 401) {
      token = await fetchAccessToken();
      const resp2 = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeader(token) },
        timeout: 25000
      });
      return resp2?.data || {};
    }
    // bubble up error with details if possible
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
    const err = new Error(`MCG get_items_list failed${status ? ` (${status})` : ''}${detail}`);
    err.status = status;
    throw err;
  }
}

export default { getItemsList };
