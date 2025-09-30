// src/userStore.js
import { createClient } from 'redis';

const url = process.env.REDIS_URL; // формат redis://:password@host:port
const host = process.env.REDIS_HOST;
const port = process.env.REDIS_PORT;
const password = process.env.REDIS_PASSWORD;

const client = createClient(
  url
    ? { url }
    : { socket: { host, port: port ? Number(port) : 6379 }, password }
);

client.on('error', (e) => console.error('[redis]', e));
await client.connect();

const key = (userId) => `user:${userId}:balance`;

/** Получить баланс (число) */
export async function getBalance(userId) {
  const v = await client.get(key(userId));
  return v ? parseFloat(v) : 0;
}

/** Установить баланс */
export async function setBalance(userId, amount) {
  await client.set(key(userId), Number(amount) || 0);
}

/** Пополнить (атомарно) */
export async function addBalance(userId, amount) {
  return client.incrByFloat(key(userId), Number(amount) || 0);
}

/** Списать (атомарно) */
export async function chargeBalance(userId, amount) {
  return client.incrByFloat(key(userId), -Math.abs(Number(amount) || 0));
}
