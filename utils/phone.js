// Simple E.164-ish normalization
// - Keep digits and leading +
// - Remove extra leading zeros after country code when possible
// Note: For full accuracy consider using libphonenumber-js; this lightweight helper avoids external deps.
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhoneE164ish(input, region) {
  if (!input) return '';
  const raw = String(input).trim();
  // Try robust parsing with libphonenumber-js first
  try {
    const parsed = parsePhoneNumberFromString(raw, region || undefined);
    if (parsed && parsed.isValid()) return parsed.number; // E.164 format like +15551234567
  } catch {}
  // Keep + and digits only
  let s = raw.replace(/[^0-9+]/g, '');
  // Collapse multiple +'s, allow only one at start
  s = s.replace(/^\++/, '+')
       .replace(/(?!^)\+/g, '');
  // If no leading + and looks like local with leading zeros, remove them
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
  }
  // Reject too short
  if (!/^\+?[0-9]{7,16}$/.test(s)) return s;
  return s;
}
