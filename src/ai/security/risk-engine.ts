/**
 * AI Session Risk Engine
 *
 * Sliding-window risk scoring per userId, stored in Redis. Events from the
 * classifier and scrubber accumulate into a score; the score maps to a
 * level (LOW/MEDIUM/HIGH/CRITICAL) that the chat route uses to degrade
 * helpfulness.
 *
 * Storage (per user):
 *   - ZSET  ai:risk:events:<uid>  — member="<type>:<points>:<uuid>", score=timestampMs
 *   - KEY   ai:lockout:<uid>      — exists while user is in CRITICAL lockout
 *
 * The ZSET self-prunes (we ZREMRANGEBYSCORE on every read), and the parent
 * key has a hard TTL so abandoned sessions don't linger in Redis.
 *
 * Phase 2 behaviour:
 *   - LOW       (0-24)   → no change; classifier rules apply as-is.
 *   - MEDIUM    (25-49)  → `sensitive` classifications get escalated to refuse.
 *   - HIGH      (50-79)  → every prompt gets the canned refusal; no tools.
 *   - CRITICAL  (80+)    → HIGH behaviour + 10-min lockout + admin alert.
 */

import { v4 as uuidv4 } from 'uuid';
import { getRedisClient } from '../../cache/client.js';
import { logger } from '../../utils/logger.js';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Sliding window over which event points accumulate. */
const WINDOW_SECONDS = 15 * 60; // 15 min

/** Hard lockout TTL applied when score crosses CRITICAL. */
const LOCKOUT_TTL_SECONDS = 10 * 60; // 10 min

/** Level thresholds — INCLUSIVE lower bound. */
const LEVEL_THRESHOLDS = {
  CRITICAL: 80,
  HIGH: 50,
  MEDIUM: 25,
} as const;

/** Default point weights per source. */
export const POINT_WEIGHTS = {
  /** Classifier returned high_risk and we refused before any tool. */
  refusal: 25,
  /** Classifier returned sensitive (bulk export, etc). */
  sensitive: 10,
  /** Zero-result scrubber fired — model tried to suggest unsafe alternatives. */
  zero_result_block: 15,
  /** Consecutive refusals within the same minute — bonus for rapid probing. */
  rapid_probing_bonus: 10,
} as const;

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskSource = keyof typeof POINT_WEIGHTS;

// ─── Keys ────────────────────────────────────────────────────────────────────

const eventsKey = (uid: string) => `ai:risk:events:${uid}`;
const lockoutKey = (uid: string) => `ai:lockout:${uid}`;
const lastEventTsKey = (uid: string) => `ai:risk:lastevt:${uid}`;

// ─── Level math ──────────────────────────────────────────────────────────────

export function levelForScore(score: number): RiskLevel {
  if (score >= LEVEL_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (score >= LEVEL_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= LEVEL_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RiskState {
  score: number;
  level: RiskLevel;
  lockedOut: boolean;
}

/**
 * Read the user's current risk state. Prunes expired events as a side effect.
 * Safe to call on every request — runs in O(log N) per ZSET op.
 */
export async function getRiskState(userId: string): Promise<RiskState> {
  const redis = getRedisClient();
  const key = eventsKey(userId);
  const now = Date.now();
  const since = now - WINDOW_SECONDS * 1000;

  // Drop expired events, then read the survivors.
  await redis.zremrangebyscore(key, '-inf', since).catch(() => 0);
  const members = await redis.zrangebyscore(key, since, now).catch(() => [] as string[]);

  let score = 0;
  for (const m of members) {
    // member format: "<source>:<points>:<uuid>"
    const parts = m.split(':');
    const pts = Number(parts[1]);
    if (Number.isFinite(pts)) score += pts;
  }

  const lockedOut = (await redis.exists(lockoutKey(userId)).catch(() => 0)) === 1;
  return { score, level: levelForScore(score), lockedOut };
}

/**
 * Add points to a user's risk score. Returns the new state INCLUDING whether
 * the level transitioned upward (caller uses this for alerts / lockout).
 */
export async function recordRiskEvent(
  userId: string,
  source: RiskSource,
  extraPoints = 0,
): Promise<{ before: RiskState; after: RiskState; transitioned: boolean }> {
  const before = await getRiskState(userId);

  const basePoints = POINT_WEIGHTS[source];
  const points = basePoints + extraPoints;

  const redis = getRedisClient();
  const key = eventsKey(userId);
  const now = Date.now();
  const member = `${source}:${points}:${uuidv4()}`;

  await redis.zadd(key, now, member).catch((err) =>
    logger.warn({ err, userId }, 'risk engine: zadd failed'),
  );
  await redis.expire(key, WINDOW_SECONDS).catch(() => 0);

  // Rapid-probing detector: if this is the SECOND refusal within 60s, apply
  // the bonus. Lightweight, no ZSET scan required.
  if (source === 'refusal') {
    const lastTs = Number((await redis.get(lastEventTsKey(userId)).catch(() => '0')) ?? 0);
    if (lastTs && now - lastTs < 60_000) {
      await redis.zadd(
        key,
        now,
        `rapid_probing_bonus:${POINT_WEIGHTS.rapid_probing_bonus}:${uuidv4()}`,
      ).catch(() => 0);
    }
    await redis.setex(lastEventTsKey(userId), 120, String(now)).catch(() => 0);
  }

  const after = await getRiskState(userId);

  // Trigger lockout the moment we cross CRITICAL.
  if (after.level === 'CRITICAL' && !before.lockedOut) {
    await redis.setex(lockoutKey(userId), LOCKOUT_TTL_SECONDS, '1').catch(() => 0);
    after.lockedOut = true;
  }

  const transitioned = after.level !== before.level;
  return { before, after, transitioned };
}

/** Drop all risk state for a user — admin "give them a clean slate". */
export async function clearRisk(userId: string): Promise<void> {
  const redis = getRedisClient();
  await Promise.all([
    redis.del(eventsKey(userId)).catch(() => 0),
    redis.del(lockoutKey(userId)).catch(() => 0),
    redis.del(lastEventTsKey(userId)).catch(() => 0),
  ]);
}
