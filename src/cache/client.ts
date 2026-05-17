/**
 * Redis client singleton.
 * Uses ioredis with reconnect strategy and key namespacing.
 */

import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let _client: Redis | null = null;

export function getRedisClient(): Redis {
  if (_client) return _client;

  _client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    keyPrefix: env.REDIS_KEY_PREFIX,
    // Reconnect on failure with exponential back-off (cap 30 s)
    retryStrategy(times) {
      if (times > 10) return null; // Stop retrying after 10 attempts
      return Math.min(times * 200, 30_000);
    },
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    connectTimeout: 10_000,
    commandTimeout: 5_000,
  });

  _client.on('connect', () => logger.info('Redis connected'));
  _client.on('ready', () => logger.info('Redis ready'));
  _client.on('error', (err) => logger.error({ err }, 'Redis error'));
  _client.on('close', () => logger.warn('Redis connection closed'));
  _client.on('reconnecting', (ms: number) =>
    logger.info({ ms }, 'Redis reconnecting'),
  );

  return _client;
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
    logger.info('Redis connection closed');
  }
}

export async function pingRedis(): Promise<void> {
  const client = getRedisClient();
  const pong = await client.ping();
  if (pong !== 'PONG') throw new Error('Redis ping failed');
}
