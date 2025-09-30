// src/laximoClient.js
import { fetch } from 'undici';
import { cacheGet, cacheSet } from './cache.js';

const BASE = process.env.LAXIMO_BASE_URL?.replace(/\/+$/, '') || '';
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'ru_RU';

// TTL 24 часа
const VIN_TTL = 24 * 60 * 60; // 86400 сек

/**
 * Получить данные по VIN.
 * @param {string} vin
 * @param {string} locale
 * @param {{ force?: boolean }=} opts  force=true — пропустить кэш и обновить его
 */
export async function getByVin(vin, locale = DEFAULT_LOCALE, opts = {}) {
  if (!BASE) throw new Error('LAXIMO_BASE_URL is not set');
  const key = `vin:${vin}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/vin?vin=${encodeURIComponent(vin)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Laximo /vin failed: ${res.status} ${res.statusText}`);

  const data = await res.json();

  // Кладём в кэш целиком ответ бэкенда (с полями ok/data/vin/locale)
  try { await cacheSet(key, data, VIN_TTL); } catch (e) { /* не критично */ }

  return data;
}
