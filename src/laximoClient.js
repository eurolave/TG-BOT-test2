// src/laximoClient.js
import { fetch } from 'undici';
import { cacheGet, cacheSet } from './cache.js';
import crypto from 'crypto';

const BASE = process.env.LAXIMO_BASE_URL?.replace(/\/+$/, '') || '';
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'ru_RU';

// TTL 24 часа
const VIN_TTL   = 24 * 60 * 60; // 86400
const UNITS_TTL = 24 * 60 * 60; // 86400

const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

/**
 * Получить данные по VIN (из кэша или REST).
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

  try { await cacheSet(key, data, VIN_TTL); } catch {}
  return data;
}

/**
 * Получить список узлов по catalog+ssd (из кэша или REST).
 * Ожидаемый формат REST:
 * { ok: true, catalog: "...", locale: "...", ssd: "...",
 *   data: [{ id, name, ... }, ...] } // массив узлов
 */
export async function getUnits(catalog, ssd, locale = DEFAULT_LOCALE, opts = {}) {
  if (!BASE) throw new Error('LAXIMO_BASE_URL is not set');
  const key = `units:${catalog}:${h(ssd)}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/units?catalog=${encodeURIComponent(catalog)}&ssd=${encodeURIComponent(ssd)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    // если бэкенда пока нет — аккуратно сообщим
    if (res.status === 404) {
      throw new Error('Эндпоинт /units не найден на REST-сервисе. Добавьте его в Laximo-Connect.');
    }
    throw new Error(`Laximo /units failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  try { await cacheSet(key, data, UNITS_TTL); } catch {}
  return data;
}
