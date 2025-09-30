import { fetch } from 'undici';
const BASE = process.env.LAXIMO_BASE_URL?.replace(/\/+$/, '') || '';
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'ru_RU';

export async function getByVin(vin, locale = DEFAULT_LOCALE) {
  const url = `${BASE}/vin?vin=${encodeURIComponent(vin)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Laximo /vin failed: ${res.status} ${res.statusText}`);
  return res.json();
}
