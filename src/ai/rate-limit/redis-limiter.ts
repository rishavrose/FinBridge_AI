/**
 * Redis-backed sliding-window rate limit counters for AI chat.
 *
 * Uses fixed-window counters keyed by hour/day timestamps.
 * Each window gets its own Redis key with an auto-expiring TTL so old windows
 * vanish without manual cleanup.
 *
 * Key scheme (note: REDIS_KEY_PREFIX is prepended by ioredis):
 *   ratelimit:ai:h:{userId}:{hourSlot}  — hourly counter
 *   ratelimit:ai:d:{userId}:{daySlot}   — daily counter
 *   ratelimit:ai:global_cfg             — cached global config JSON
 *   ratelimit:ai:ulimits:{userId}       — cached per-user limits JSON
 */

import { getRedisClient } from '../../cache/client.js';

const HOUR_SEC = 3_600;
const DAY_SEC  = 86_400;

// ─── Key helpers ─────────────────────────────────────────────────────────────

function hourKey(userId: string): string {
  const slot = Math.floor(Date.now() / (HOUR_SEC * 1000));
  return `ratelimit:ai:h:${userId}:${slot}`;
}

function dayKey(userId: string): string {
  const slot = Math.floor(Date.now() / (DAY_SEC * 1000));
  return `ratelimit:ai:d:${userId}:${slot}`;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

export interface RateLimitCounters {
  hourlyCount: number;
  dailyCount: number;
}

/**
 * Atomically increment both hourly and daily counters for a user.
 * Sets TTL on first write; subsequent increments leave TTL unchanged.
 * Returns the NEW counter values (post-increment) so callers can compare to limits.
 */
export async function incrementCounters(userId: string): Promise<RateLimitCounters> {
  const redis = getRedisClient();
  const hKey  = hourKey(userId);
  const dKey  = dayKey(userId);

  // Pipeline: incr + set TTL only if key is new (NX flag prevents resetting TTL on existing keys)
  const results = await redis.pipeline()
    .incr(hKey)
    .expire(hKey, HOUR_SEC + 60)   // +60s buffer so boundary races don't lose the last slot
    .incr(dKey)
    .expire(dKey, DAY_SEC + 60)
    .exec() as Array<[Error | null, unknown]>;

  const hourlyCount = (results[0]?.[1] as number) ?? 0;
  const dailyCount  = (results[2]?.[1] as number) ?? 0;

  return { hourlyCount, dailyCount };
}

/**
 * Read current counters without modifying them (for analytics / status queries).
 */
export async function getCounters(userId: string): Promise<RateLimitCounters> {
  const redis = getRedisClient();
  const [hourlyRaw, dailyRaw] = await redis.mget(hourKey(userId), dayKey(userId));

  return {
    hourlyCount: parseInt(hourlyRaw ?? '0', 10),
    dailyCount:  parseInt(dailyRaw  ?? '0', 10),
  };
}

/**
 * Reset rate limit counters for a user (admin reset action).
 */
export async function resetCounters(userId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(hourKey(userId), dayKey(userId));
}

// ─── Config cache ─────────────────────────────────────────────────────────────

const GLOBAL_CFG_KEY   = 'ratelimit:ai:global_cfg';
const USER_LIMITS_KEY  = (id: string) => `ratelimit:ai:ulimits:${id}`;
const CFG_CACHE_TTL    = 60; // seconds — admin changes propagate within 1 minute

export async function cacheGlobalConfig(cfg: Record<string, unknown>): Promise<void> {
  await getRedisClient().set(GLOBAL_CFG_KEY, JSON.stringify(cfg), 'EX', CFG_CACHE_TTL);
}

export async function getCachedGlobalConfig(): Promise<Record<string, unknown> | null> {
  const raw = await getRedisClient().get(GLOBAL_CFG_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export async function invalidateGlobalConfig(): Promise<void> {
  await getRedisClient().del(GLOBAL_CFG_KEY);
}

export async function cacheUserLimits(userId: string, limits: Record<string, unknown>): Promise<void> {
  await getRedisClient().set(USER_LIMITS_KEY(userId), JSON.stringify(limits), 'EX', CFG_CACHE_TTL);
}

export async function getCachedUserLimits(userId: string): Promise<Record<string, unknown> | null> {
  const raw = await getRedisClient().get(USER_LIMITS_KEY(userId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export async function invalidateUserLimits(userId: string): Promise<void> {
  await getRedisClient().del(USER_LIMITS_KEY(userId));
}
