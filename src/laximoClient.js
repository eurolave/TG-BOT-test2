// src/laximoClient.js
import { fetch } from 'undici';
import { cacheGet, cacheSet } from './cache.js';
import crypto from 'crypto';

const BASE = process.env.LAXIMO_BASE_URL?.replace(/\/+$/, '') || '';
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'ru_RU';

// TTL 24 часа
const VIN_TTL        = 24 * 60 * 60; // 86400
const CATEGORIES_TTL = 24 * 60 * 60;
const UNITS_TTL      = 24 * 60 * 60;
const UNITDET_TTL    = 24 * 60 * 60;

const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

// ───────────────── helpers ─────────────────
function assertBase() {
  if (!BASE) throw new Error('LAXIMO_BASE_URL is not set');
}

async function jsonFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} at ${url}\n${txt || ''}`.trim());
  }
  return res.json();
}

// Собираем k=v|k=v... и кодируем целиком
function encodeCatQuery(paramsObj) {
  const parts = Object.entries(paramsObj).map(([k, v]) => `${k}=${String(v)}`);
  return encodeURIComponent(parts.join('|'));
}

// ───────────────── API ─────────────────

/** VIN → карточка авто (кэшируется) */
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
 * Категории по catalog + vehicleId + root ssd (кэшируется)
 * REST: /categories?catalog=...&vehicleId=...&ssd=...&locale=...
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
 * Узлы по категории (ВАЖНО: нужен categoryId + vehicleId + ssd категории)
 * REST: /units?catalog=...&vehicleId=...&categoryId=...&ssd=...&locale=...
 */
export async function getUnits(catalog, vehicleId, categoryId, ssd, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `units:${catalog}:${vehicleId || '0'}:${String(categoryId)}:${h(ssd)}:${locale}`;

  if (!opts.force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/units?catalog=${encodeURIComponent(catalog)}&vehicleId=${encodeURIComponent(vehicleId || '0')}&categoryId=${encodeURIComponent(String(categoryId))}&ssd=${encodeURIComponent(ssd)}&locale=${encodeURIComponent(locale)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, UNITS_TTL); } catch {}
  return data;
}

/**
 * Детали узла (ListDetailByUnit) — по UnitId + ssd (ssd от уровня категории/узлов)
 * REST: /unit-details?catalog=...&vehicleId=...&unitId=...&ssd=...&locale=...&localized=true&withLinks=true
 */
export async function getUnitDetailsByUnitId(
  catalog,
  vehicleId,
  unitId,
  ssd,
  locale = DEFAULT_LOCALE,
  opts = { localized: true, withLinks: true, force: false }
) {
  assertBase();
  const localized  = opts.localized !== false;
  const withLinks  = opts.withLinks !== false;
  const force      = !!opts.force;

  const key = `unitdet:${catalog}:${vehicleId || '0'}:${String(unitId)}:${h(ssd)}:${locale}:${localized?1:0}:${withLinks?1:0}`;

  if (!force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  }

  const url = `${BASE}/unit-details?catalog=${encodeURIComponent(catalog)}&vehicleId=${encodeURIComponent(vehicleId || '0')}&unitId=${encodeURIComponent(String(unitId))}&ssd=${encodeURIComponent(ssd)}&locale=${encodeURIComponent(locale)}&localized=${String(localized)}&withLinks=${String(withLinks)}`;
  const data = await jsonFetch(url);

  try { await cacheSet(key, data, UNITDET_TTL); } catch {}
  return data;
}

/**
 * Оставляю и этот вариант — если ты используешь /unit по ssd узла.
 * REST: /unit?catalog=...&vehicleId=...&ssd=...&locale=...
 */
export async function getUnitDetailsBySsd(catalog, vehicleId, unitSsd, locale = DEFAULT_LOCALE, opts = {}) {
  assertBase();
  const key = `unitdet:ssd:${catalog}:${vehicleId || '0'}:${h(unitSsd)}:${locale}`;

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
 * Сервисная сборка сырого запроса /cat?q=ListDetailByUnit:...
 * Удобно для ручной проверки. Лучше пользоваться /unit-details в проде.
 */
export function buildListDetailByUnitUrl({
  catalog,
  unitId,
  ssd,
  locale = DEFAULT_LOCALE,
  localized = true,
  withLinks = true
}) {
  assertBase();
  const inner = encodeCatQuery({
    Locale: locale,
    Catalog: catalog,
    UnitId: unitId,
    ssd: ssd,
    Localized: String(localized),
    WithLinks: String(withLinks),
  });
  const qValue = `ListDetailByUnit:${inner}`;
  // безопасно кодируем q как значение параметра
  const url = new URL(`${BASE}/cat`);
  url.searchParams.set('q', qValue);
  return url.toString();
}
