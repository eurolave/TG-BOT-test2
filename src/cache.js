// src/cache.js
// Универсальный TTL-кэш: Redis (если env задан) или in-memory (фолбэк)

let redisClient = null;

async function initRedis() {
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  if (!url && !host) return null;

  try {
    const { createClient } = await import('redis');
    const client = createClient(
      url
        ? { url }
        : { socket: { host, port: port ? Number(port) : 6379 }, password }
    );
    client.on('error', (e) => console.error('[redis]', e));
    await client.connect();
    return client;
  } catch (e) {
    console.warn('[cache] Redis не доступен (нет зависимости или ошибка подключения). Использую in-memory.', e.message || e);
    return null;
  }
}

// ─────────── In-memory TTL cache (фолбэк) ───────────
class MemoryTTL {
  constructor() {
    this.map = new Map(); // key -> { value, exp }
    this.timer = setInterval(() => this.gc(), 60_000).unref?.();
  }
  gc() {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.exp <= now) this.map.delete(k);
    }
  }
  async get(key) {
    const rec = this.map.get(key);
    if (!rec) return null;
    if (rec.exp <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return rec.value;
  }
  async set(key, value, ttlSeconds) {
    const exp = Date.now() + (ttlSeconds * 1000);
    this.map.set(key, { value, exp });
  }
}

let mem = new MemoryTTL();

// Публичный API кэша
export async function cacheGet(key) {
  if (!redisClient) redisClient = await initRedis();
  if (redisClient) {
    const v = await redisClient.get(key);
    return v ? JSON.parse(v) : null;
  }
  return mem.get(key);
}

export async function cacheSet(key, value, ttlSeconds) {
  if (!redisClient) redisClient = await initRedis();
  if (redisClient) {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return;
  }
  await mem.set(key, value, ttlSeconds);
}
