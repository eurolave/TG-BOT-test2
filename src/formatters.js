import { escapeMd } from './utils.js';

export function summarizeVinResponse(json) {
  const data = json?.data ?? json;
  const flat = [];

  const pickScalars = (obj, prefix='') => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v == null) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        flat.push([key, v]);
      } else if (typeof v === 'object' && !Array.isArray(v)) {
        pickScalars(v, key);
      }
    }
  };

  if (Array.isArray(data)) { data[0] && pickScalars(data[0]); }
  else if (data && typeof data === 'object') { pickScalars(data); }

  const lines = [
    `*VIN найден*`,
    '',
    ...flat.slice(0, 12).map(([k, v]) => `• *${escapeMd(k)}*: ${escapeMd(String(v))}`),
    flat.length > 12 ? `… и ещё ${flat.length - 12} полей` : ''
  ].filter(Boolean);

  return lines.join('\n');
}
