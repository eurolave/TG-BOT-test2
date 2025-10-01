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

/** Сохраняем список категорий (categoryId+name+ssd) */
export async function saveCategoriesSession(userId, catalog, vehicleId, rootArray, ttlSec = TTL_CATS) {
  const data = (Array.isArray(rootArray) ? rootArray : []).map(c => ({
    categoryId: c.categoryId,
    name: c.name,
    ssd: c.ssd
  }));
  const key = `cats:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  const payload = JSON.stringify(data);
  if (r) await r.set(key, payload, { EX: ttlSec }); else memSet(key, payload, ttlSec);
}

/** Получить SSD по categoryId */
export async function getCategorySsd(userId, catalog, vehicleId, categoryId) {
  const key = `cats:${userId}:${catalog}:${vehicleId}`;
  const r = await getRedis();
  let raw = r ? await r.get(key) : memGet(key);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    const found = arr.find(x => String(x.categoryId) === String(categoryId));
    return found?.ssd || null;
  } catch {
    return null;
  }
}

/** Храним текущий автомобиль (catalog, vehicleId) для пользователя */
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

/** ───────── Совместимость с существующим кодом: cacheGet/cacheSet ─────────
 * Некоторые модули ожидают универсальные функции кэша.
 * Эти шимирующие функции работают с JSON-значениями:
 *  - cacheSet(key, value, ttlSec) — сериализует value в JSON
 *  - cacheGet(key) — парсит JSON и возвращает объект/массив/скаляр
 */

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
    // если вдруг кто-то положил не-JSON — вернём сырой
    return raw;
  }
}
