// src/laximoClient.js
import { fetch } from 'undici';
import { cacheGet, cacheSet } from './cache.js';
import crypto from 'crypto';

const BASE = process.env.LAXIMO_BASE_URL?.replace(/\/+$/, '') || '';
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'ru_RU';

// TTL 24 часа
const VIN_TTL       = 24 * 60 * 60; // 86400
const UNITS_TTL     = 24 * 60 * 60; // 86400
const CATEGORIES_TTL= 24 * 60 * 60; // 86400
const UNITDET_TTL   = 24 * 60 * 60; // 86400

const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

// ───────────────── helpers ─────────────────
function assertBase() {
  if (!BASE) throw new Error('LAXIMO_BASE_URL is not set');
}

async function jsonFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    // чуть более дружелюбные ошибки
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} at ${url}\n${txt || ''}`.trim());
  }
  return res.json();
}

// Кодируем строку для /cat?q=...
function encodeCatQuery(paramsObj) {
  const parts = Object.entries(paramsObj).map(([k, v]) => `${k}=${String(v)}`);
  return encodeURIComponent(parts.join('|'));
}

// ───────────────── API ─────────────────

/**
 * VIN → карточка авто (кэшируется)
 */
export async function getByVin(vin, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `vin:${vin}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/vin?vin=${encodeURIComponent(vin)}&locale=${encodeURIComponent(locale)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, VIN_TTL); } catch {}
  return data;
}

/**
 * Категории по catalog + ssd корня (кэшируется)
 * Ожидаемый REST: /categories?catalog=...&vehicleId=...&ssd=...&locale=...
 */
export async function getCategories(catalog, vehicleId, ssd, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `cats:${catalog}:${vehicleId || '0'}:${h(ssd)}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/categories?catalog=${encodeURIComponent(catalog)}&vehicleId=${encodeURIComponent(vehicleId || '0')}&ssd=${encodeURIComponent(ssd)}&locale=${encodeURIComponent(locale)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, CATEGORIES_TTL); } catch {}
  return data;
}

/**
 * Узлы по catalog + ssd (кэшируется)
 * Ожидаемый REST: /units?catalog=...&vehicleId=...&ssd=...&locale=...
 * NB: у тебя уже работало — оставляю как было, но добавляю vehicleId (по коду выше он тоже нужен).
 */
export async function getUnits(catalog, ssd, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `units:${catalog}:${h(ssd)}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/units?catalog=${encodeURIComponent(catalog)}&ssd=${encodeURIComponent(ssd)}&locale=${encodeURIComponent(locale)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, UNITS_TTL); } catch {}
  return data;
}

/**
 * Детали/состав конкретного узла (по SSD узла!) — кэшируется.
 * В твоём Telegram-коде это /unit?catalog=...&vehicleId=...&ssd=<ssd узла>
 */
export async function getUnitDetailsBySsd(catalog, vehicleId, unitSsd, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `unitdet:${catalog}:${vehicleId || '0'}:${h(unitSsd)}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/unit?catalog=${encodeURIComponent(catalog)}&vehicleId=${encodeURIComponent(vehicleId || '0')}&ssd=${encodeURIComponent(unitSsd)}&locale=${encodeURIComponent(locale)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, UNITDET_TTL); } catch {}
  return data;
}

/**
 * Сервисная функция: собрать raw /cat?q=ListDetailByUnit... для ручной проверки.
 * НЕ для прод-использования если у тебя есть /unit.
 *
 * Пример:
 *   buildListDetailByUnitUrl({
 *     catalog: 'AU1587',
 *     unitId: '80732',
 *     ssd: '$*....',       // SSD ИМЕННО УЗЛА
 *     locale: 'ru_RU',
 *     localized: true
 *   })
 */
export function buildListDetailByUnitUrl({ catalog, unitId, ssd, locale = DEFAULT_LOCALE, localized = true }) {
  assertBase();
  const q = [
    'ListDetailByUnit',
    encodeCatQuery({
      Locale: locale,
      Catalog: catalog,
      UnitId: unitId,
      ssd,                    // важно: ровно как получили, без модификаций
      Localized: String(localized)
    })
  ].join(':');
  return `${BASE}/cat?q=${q}`;
}
