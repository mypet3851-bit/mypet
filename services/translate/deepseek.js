// DeepSeek translation service (uses OpenAI-compatible chat completions API)
// Env: DEEPSEEK_API_KEY (required)

const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * Translate a single text using DeepSeek chat API.
 * @param {string} text Source text
 * @param {string} from Source language code (e.g., 'en')
 * @param {string} to Target language code (e.g., 'he')
 * @returns {Promise<string>} Translated text
 */
export async function deepseekTranslate(text, from, to) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY missing');
  const prompt = `You are a professional translator. Translate the following text from ${from} to ${to}. Preserve placeholders like {{name}} and HTML tags if present. Only return the translated text without quotes.

Text:
${text}`;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You translate text precisely and preserve placeholders like {{name}} and HTML formatting.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error ${res.status}: ${txt.slice(0,200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty translation result');
  return content;
}

/**
 * Batch translate an array of items.
 * @param {Array<{id:string,text:string}>} items
 * @param {string} from
 * @param {string} to
 */
export async function deepseekTranslateBatch(items, from, to) {
  // For simplicity, translate sequentially to keep prompt quality high; could parallelize with Promise.allSettled if needed.
  const results = [];
  for (const it of items) {
    try {
      const translated = await deepseekTranslate(it.text, from, to);
      results.push({ id: it.id, text: translated });
    } catch (e) {
      results.push({ id: it.id, error: e?.message || 'translate_failed' });
    }
  }
  return results;
}
