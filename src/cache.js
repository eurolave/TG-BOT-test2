// src/cache.js
// Кэш + контекст пользователя. Redis опционален, fallback — in-memory.

import { createClient } from 'redis';

const TTL_CATS = 900; // 15 минут
const TTL_CTX  = 3600;

let redis = null;
const mem = new Map(); // key -> { value, exp }

async function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redis = createClient({ url });
    redis.on('error', (e) => console.error('[redis]', e?.message || e));
    await redis.connect();
    console.log('[redis-cache] connected');
    return redis;
  } catch (e) {
    console.warn('[redis-cache] unavailable, memory fallback:', e?.message || e);
    redis = null;
    return null;
  }
}

function memSet(k, v, ttlSec) {
  mem.set(k, { value: v, exp: Date.now() + (ttlSec * 1000) });
}
function memGet(k) {
  const it = mem.get(k);
  if (!it) return null;
  if (it.exp <= Date.now()) { mem.delete(k); return null; }
  return it.value;
}

/** ───────── High-level API для категорий/контекста ───────── */

// нормализация полей категории из разных форматов
function normalizeCategory(c = {}) {
  const id =
    c.categoryId ?? c.id ?? c.code ?? null;
  const name =
    c.name ?? c.title ?? '';
  const ssd =
    c.ssd ?? c.SSD ?? c.sSd ?? null;
  return { categoryId: id, name, ssd };
}

/** Сохранить плоский список корневых категорий (id+name+ssd) для быстрого поиска ssd */
export async function saveCategoriesSession(userId, catalog, vehicleId, rootArray, ttlSec = TTL_CATS) {
  const data = (Array.isArray(rootArray) ? rootArray : [])
    .map(normalizeCategory)
    .filter(x => x.categoryId != null);

  const key = `cats:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  const payload = JSON.stringify(data);
  if (r) await r.set(key, payload, { EX: ttlSec }); else memSet(key, payload, ttlSec);
}

async function readCategoriesSession(userId, catalog, vehicleId) {
  const key = `cats:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  const raw = r ? await r.get(key) : memGet(key);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) || [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Получить полную запись категории по её идентификатору */
export async function getCategoryRecord(userId, catalog, vehicleId, categoryId) {
  const list = await readCategoriesSession(userId, catalog, vehicleId);
  if (!Array.isArray(list)) return null;

  const found = list.find(x => String(x?.categoryId) === String(categoryId));
  return found ? { ...found } : null;
}

/** Получить SSD по categoryId (совместимость) */
export async function getCategorySsd(userId, catalog, vehicleId, categoryId) {
  const record = await getCategoryRecord(userId, catalog, vehicleId, categoryId);
  return record?.ssd ?? null;
}

/** Храним текущий автомобиль (catalog, vehicleId, rootSsd) для пользователя */
export async function setUserVehicle(userId, vehicle) {
  const key = `ctx:${userId}:veh`;
  const r = await getRedis();
  const payload = JSON.stringify(vehicle || {});
  if (r) await r.set(key, payload, { EX: TTL_CTX }); else memSet(key, payload, TTL_CTX);
}
export async function getUserVehicle(userId) {
  const key = `ctx:${userId}:veh`;
  const r = await getRedis();
  const raw = r ? await r.get(key) : memGet(key);
  return raw ? JSON.parse(raw) : null;
}

/** Полный «корень» категорий для «Обновить» (рендер из кэша без запросов) */
export async function setCategoriesRoot(userId, catalog, vehicleId, categoriesRoot, ttlSec = TTL_CATS) {
  const key = `catsroot:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  const payload = JSON.stringify(categoriesRoot ?? []);
  if (r) await r.set(key, payload, { EX: ttlSec }); else memSet(key, payload, ttlSec);
}
export async function getCategoriesRoot(userId, catalog, vehicleId) {
  const key = `catsroot:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  const raw = r ? await r.get(key) : memGet(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** ───────── Универсальные cacheGet/cacheSet (совместимость) ───────── */

export async function cacheSet(key, value, ttlSec = 900) {
  const r = await getRedis();
  const payload = JSON.stringify(value);
  if (r) {
    await r.set(key, payload, { EX: ttlSec });
  } else {
    memSet(key, payload, ttlSec);
  }
}

export async function cacheGet(key) {
  const r = await getRedis();
  const raw = r ? await r.get(key) : memGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
