/**
 * AI Semantic Cache — Redis Exact-Match Layer
 *
 * Sits in front of both vector search and OpenAI calls.
 * On a cache hit the entire API round-trip is eliminated.
 *
 * Key scheme  : <REDIS_KEY_PREFIX>ai:cache:<sha256(normalizedPrompt)>
 * Value scheme: JSON-serialised CachedResponse
 * TTL         : AI_MEMORY_CACHE_TTL seconds (default 3600 = 1 hour)
 *
 * This module is intentionally thin — it owns only the Redis I/O.
 * Business logic (normalisation, hashing) lives in src/ai/normalization/.
 */

import { getRedisClient } from '../../cache/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CachedResponse {
  /** Original AI response text */
  response: string;
  /** Knowledge base entry UUID (ai_knowledge.id) */
  knowledgeId: string;
  /** Cosine similarity score at time of caching (1.0 for exact matches) */
  confidence: number;
  /** Intent category for analytics */
  intentCategory: string;
  /** ISO timestamp when this entry was first created */
  createdAt: string;
  /** Number of times this cached entry has been served */
  hitCount: number;
}

// ─── Redis key helper ─────────────────────────────────────────────────────────

/** Builds the namespaced Redis key for a given prompt hash. */
function cacheKey(promptHash: string): string {
  return `ai:cache:${promptHash}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieves an exact-match cached response.
 * Returns null on cache miss or on any Redis error (fail-open strategy).
 */
export async function getCachedResponse(promptHash: string): Promise<CachedResponse | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(cacheKey(promptHash));
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedResponse;
    logger.debug({ promptHash, knowledgeId: cached.knowledgeId }, 'Redis cache HIT');
    return cached;
  } catch (err) {
    // Fail open — a Redis error must not block user responses
    logger.error({ err, promptHash }, 'Redis cache GET error — treating as MISS');
    return null;
  }
}

/**
 * Stores a response in Redis with the configured TTL.
 * Increments hitCount on subsequent calls for the same key.
 */
export async function setCachedResponse(
  promptHash: string,
  data: Omit<CachedResponse, 'hitCount' | 'createdAt'>,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = cacheKey(promptHash);

    // Check if already exists so we can preserve hitCount
    const existing = await redis.get(key);
    const hitCount = existing ? (JSON.parse(existing) as CachedResponse).hitCount : 0;

    const payload: CachedResponse = {
      ...data,
      hitCount: hitCount + 1,
      createdAt: existing
        ? (JSON.parse(existing) as CachedResponse).createdAt
        : new Date().toISOString(),
    };

    await redis.set(key, JSON.stringify(payload), 'EX', env.AI_MEMORY_CACHE_TTL);
    logger.debug({ promptHash, ttl: env.AI_MEMORY_CACHE_TTL }, 'Redis cache SET');
  } catch (err) {
    logger.error({ err, promptHash }, 'Redis cache SET error — continuing without cache write');
  }
}

/**
 * Removes a cached entry (e.g., after feedback indicates the response was wrong).
 */
export async function invalidateCachedResponse(promptHash: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(cacheKey(promptHash));
    logger.info({ promptHash }, 'Redis cache entry invalidated');
  } catch (err) {
    logger.error({ err, promptHash }, 'Redis cache DELETE error');
  }
}

/**
 * Returns the remaining TTL (in seconds) for a cached entry.
 * Returns -1 if the key has no TTL, -2 if it does not exist.
 */
export async function getCacheTtl(promptHash: string): Promise<number> {
  try {
    const redis = getRedisClient();
    return await redis.ttl(cacheKey(promptHash));
  } catch {
    return -2;
  }
}
