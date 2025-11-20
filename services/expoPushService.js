// Minimal Expo Push Service client without extra dependencies
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isExpoPushToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

async function postExpo(messages) {
  const fetchImpl = globalThis.fetch || (await import('node-fetch').then(m => m.default).catch(() => null));
  if (!fetchImpl) throw new Error('No fetch available. Node 18+ or node-fetch required.');

  const headers = { 'Content-Type': 'application/json' };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || res.statusText || 'Expo push send failed';
    const code = json?.errors?.[0]?.code;
    throw new Error(`[expoPush] ${msg}${code ? ' code=' + code : ''}`);
  }
  return json;
}

export async function sendExpoPush({ tokens, title, body, data, sound = 'default', priority = 'high', badge, badges }) {
  const valid = tokens.filter(isExpoPushToken);
  const invalid = tokens.filter(t => !isExpoPushToken(t));
  if (invalid.length) {
    console.warn('[expoPush] Skipping invalid tokens:', invalid.slice(0, 3), invalid.length > 3 ? `(+${invalid.length - 3} more)` : '');
  }
  if (!valid.length) return { ok: true, receipts: [], warnings: ['no_valid_tokens'] };

  const messages = valid.map(token => {
    const perTokenBadge = badges && typeof badges.get === 'function' ? badges.get(token) : undefined;
    return {
      to: token,
      sound,
      title,
      body,
      data,
      priority,
      ...(typeof perTokenBadge === 'number' ? { badge: perTokenBadge } : (typeof badge === 'number' ? { badge } : {}))
    };
  });

  const chunks = chunkArray(messages, 99); // Expo recommends ~100 per request
  const receipts = [];
  for (const chunk of chunks) {
    try {
      const res = await postExpo(chunk);
      receipts.push(res);
    } catch (e) {
      receipts.push({ error: e?.message || String(e) });
    }
  }
  return { ok: true, receipts };
}
