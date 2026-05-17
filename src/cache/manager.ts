/**
 * Cache manager — typed get/set/invalidate over Redis.
 *
 * Keys are namespaced by domain (tool, schema, etc.) and serialised as JSON.
 * TTLs are per-operation so different data classes have different freshness guarantees.
 */

import { getRedisClient } from './client.js';
import { safeJson } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import type { CacheOptions } from '../types/index.js';

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Retrieve a cached value.
 * Returns null on miss or deserialization error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(key);
    if (!raw) return null;
    return safeJson<T>(raw);
  } catch (err) {
    logger.warn({ key, err }, 'Cache GET error — treating as miss');
    return null;
  }
}

/**
 * Store a value in the cache.
 * @param ttl  Seconds before expiry.  0 = never expire (use with caution).
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  opts: CacheOptions,
): Promise<void> {
  try {
    const serialised = JSON.stringify(value);
    const client = getRedisClient();

    if (opts.ttl > 0) {
      await client.set(key, serialised, 'EX', opts.ttl);
    } else {
      await client.set(key, serialised);
    }

    // Tag-based invalidation: store key under each tag set
    if (opts.tags && opts.tags.length > 0) {
      const pipeline = client.pipeline();
      for (const tag of opts.tags) {
        pipeline.sadd(`tag:${tag}`, key);
        if (opts.ttl > 0) pipeline.expire(`tag:${tag}`, opts.ttl + 60);
      }
      await pipeline.exec();
    }
  } catch (err) {
    logger.warn({ key, err }, 'Cache SET error — continuing without cache');
  }
}

/**
 * Delete a single key.
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedisClient().del(key);
  } catch (err) {
    logger.warn({ key, err }, 'Cache DEL error');
  }
}

/**
 * Invalidate all keys associated with a tag.
 */
export async function invalidateByTag(tag: string): Promise<void> {
  const client = getRedisClient();
  try {
    const keys = await client.smembers(`tag:${tag}`);
    if (keys.length === 0) return;

    const pipeline = client.pipeline();
    for (const k of keys) pipeline.del(k);
    pipeline.del(`tag:${tag}`);
    await pipeline.exec();

    logger.debug({ tag, keys: keys.length }, 'Cache tag invalidated');
  } catch (err) {
    logger.warn({ tag, err }, 'Cache tag invalidation error');
  }
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────

/**
 * Cache-aside: return cached value or execute `fn`, cache, and return result.
 */
export async function getOrSet<T>(
  key: string,
  fn: () => Promise<T>,
  opts: CacheOptions,
): Promise<{ data: T; cached: boolean }> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return { data: cached, cached: true };
  }

  const data = await fn();
  await cacheSet(key, data, opts);
  return { data, cached: false };
}

// ─── Key builders ─────────────────────────────────────────────────────────────

export const CacheKeys = {
  schema: (database: string) => `schema:${database}`,
  tool: (toolName: string, argsHash: string) => `tool:${toolName}:${argsHash}`,
  apiKey: (keyHash: string) => `apikey:${keyHash}`,
};
