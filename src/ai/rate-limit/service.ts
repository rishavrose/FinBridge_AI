/**
 * AI Rate Limit Service
 *
 * Centralises all rate-limit decisions for the AI chat endpoint:
 *   1. Load global config from DB (Redis-cached, 60s TTL)
 *   2. Load per-user overrides from DB (Redis-cached, 60s TTL)
 *   3. Admin users always bypass limits
 *   4. Unlimited/premium users bypass count limits (but blocked status still applies)
 *   5. Blocked users are always rejected
 *   6. All others check Redis hourly/daily counters and reject if over quota
 *   7. On allow: increment counters and fire-and-forget MySQL usage tracking
 *
 * Admin operations (set config, block/unblock, set user limits, analytics) are
 * also exported from here so the admin route handler is thin.
 */

import { executeSelect, executeWrite } from '../../database/client.js';
import { logger } from '../../utils/logger.js';
import {
  incrementCounters,
  getCounters,
  resetCounters,
  cacheGlobalConfig,
  getCachedGlobalConfig,
  invalidateGlobalConfig,
  cacheUserLimits,
  getCachedUserLimits,
  invalidateUserLimits,
} from './redis-limiter.js';

// ─── DB row shapes ────────────────────────────────────────────────────────────

interface RateConfigRow {
  ai_enabled: number;
  hourly_limit: number;
  daily_limit: number;
}

interface UserLimitsRow {
  is_blocked: number;
  is_unlimited: number;
  hourly_limit: number | null;
  daily_limit: number | null;
  plan_type: string;
  block_reason: string | null;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GlobalConfig {
  aiEnabled: boolean;
  hourlyLimit: number;
  dailyLimit: number;
}

export interface UserLimits {
  isBlocked: boolean;
  isUnlimited: boolean;
  hourlyLimit: number | null;
  dailyLimit: number | null;
  planType: string;
  blockReason: string | null;
}

export interface LimitCheckResult {
  allowed: boolean;
  /** HTTP-level reason code when not allowed */
  code?: 'AI_DISABLED' | 'USER_BLOCKED' | 'HOURLY_LIMIT' | 'DAILY_LIMIT';
  message?: string;
  hourlyCount: number;
  dailyCount: number;
  hourlyLimit: number;
  dailyLimit: number;
}

// ─── Config loading ───────────────────────────────────────────────────────────

export async function getGlobalConfig(): Promise<GlobalConfig> {
  const cached = await getCachedGlobalConfig();
  if (cached) {
    return {
      aiEnabled:   cached.aiEnabled   as boolean,
      hourlyLimit: cached.hourlyLimit as number,
      dailyLimit:  cached.dailyLimit  as number,
    };
  }

  const rows = await executeSelect<RateConfigRow>(
    'SELECT ai_enabled, hourly_limit, daily_limit FROM ai_rate_config WHERE id = 1',
    [],
  );

  // If the table is empty (fresh DB without seed), fall back to safe defaults
  const row = rows[0] ?? { ai_enabled: 1, hourly_limit: 100, daily_limit: 1000 };

  const cfg: GlobalConfig = {
    aiEnabled:   row.ai_enabled === 1,
    hourlyLimit: row.hourly_limit,
    dailyLimit:  row.daily_limit,
  };

  await cacheGlobalConfig(cfg as unknown as Record<string, unknown>);
  return cfg;
}

export async function getUserLimits(userId: string): Promise<UserLimits | null> {
  const cached = await getCachedUserLimits(userId);
  if (cached) {
    return {
      isBlocked:   cached.isBlocked   as boolean,
      isUnlimited: cached.isUnlimited as boolean,
      hourlyLimit: cached.hourlyLimit as number | null,
      dailyLimit:  cached.dailyLimit  as number | null,
      planType:    cached.planType    as string,
      blockReason: cached.blockReason as string | null,
    };
  }

  const rows = await executeSelect<UserLimitsRow>(
    `SELECT is_blocked, is_unlimited, hourly_limit, daily_limit, plan_type, block_reason
     FROM ai_user_limits WHERE user_id = ?`,
    [userId],
  );

  if (!rows[0]) return null;

  const limits: UserLimits = {
    isBlocked:   rows[0].is_blocked   === 1,
    isUnlimited: rows[0].is_unlimited === 1,
    hourlyLimit: rows[0].hourly_limit,
    dailyLimit:  rows[0].daily_limit,
    planType:    rows[0].plan_type,
    blockReason: rows[0].block_reason,
  };

  await cacheUserLimits(userId, limits as unknown as Record<string, unknown>);
  return limits;
}

// ─── Core check + increment ───────────────────────────────────────────────────

/**
 * Primary gate: call this at the start of every AI chat request.
 * Returns `allowed: true` when the request may proceed, incrementing counters atomically.
 * Returns `allowed: false` with a reason code when the request must be rejected.
 *
 * Admin role always bypasses all limits.
 */
export async function checkAndIncrementLimit(
  userId: string,
  role: string,
): Promise<LimitCheckResult> {
  // Admins have full bypass — no counters incremented
  if (role === 'admin') {
    return { allowed: true, hourlyCount: 0, dailyCount: 0, hourlyLimit: 0, dailyLimit: 0 };
  }

  const [globalCfg, userLimits] = await Promise.all([
    getGlobalConfig(),
    getUserLimits(userId),
  ]);

  // Global kill-switch
  if (!globalCfg.aiEnabled) {
    const { hourlyCount, dailyCount } = await getCounters(userId);
    return {
      allowed: false,
      code: 'AI_DISABLED',
      message: 'AI is currently disabled. Please try again later.',
      hourlyCount,
      dailyCount,
      hourlyLimit: globalCfg.hourlyLimit,
      dailyLimit:  globalCfg.dailyLimit,
    };
  }

  // Blocked user
  if (userLimits?.isBlocked) {
    const { hourlyCount, dailyCount } = await getCounters(userId);
    return {
      allowed: false,
      code: 'USER_BLOCKED',
      message: userLimits.blockReason ?? 'Your AI access has been suspended. Contact support.',
      hourlyCount,
      dailyCount,
      hourlyLimit: userLimits.hourlyLimit ?? globalCfg.hourlyLimit,
      dailyLimit:  userLimits.dailyLimit  ?? globalCfg.dailyLimit,
    };
  }

  // Unlimited / premium plan — bypass counters
  if (userLimits?.isUnlimited) {
    trackUsage(userId).catch(() => {}); // fire-and-forget
    return { allowed: true, hourlyCount: 0, dailyCount: 0, hourlyLimit: 0, dailyLimit: 0 };
  }

  // Effective limits: user-specific override or global fallback
  const effectiveHourly = userLimits?.hourlyLimit ?? globalCfg.hourlyLimit;
  const effectiveDaily  = userLimits?.dailyLimit  ?? globalCfg.dailyLimit;

  // Increment atomically; new value tells us if we just crossed the limit
  const { hourlyCount, dailyCount } = await incrementCounters(userId);

  if (hourlyCount > effectiveHourly) {
    return {
      allowed: false,
      code: 'HOURLY_LIMIT',
      message: `Hourly AI request limit of ${effectiveHourly} exceeded. Resets next hour.`,
      hourlyCount,
      dailyCount,
      hourlyLimit: effectiveHourly,
      dailyLimit:  effectiveDaily,
    };
  }

  if (dailyCount > effectiveDaily) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      message: `Daily AI request limit of ${effectiveDaily} exceeded. Resets at midnight UTC.`,
      hourlyCount,
      dailyCount,
      hourlyLimit: effectiveHourly,
      dailyLimit:  effectiveDaily,
    };
  }

  // Allowed — track usage in MySQL (non-blocking)
  trackUsage(userId).catch(() => {});

  return {
    allowed: true,
    hourlyCount,
    dailyCount,
    hourlyLimit: effectiveHourly,
    dailyLimit:  effectiveDaily,
  };
}

// ─── MySQL usage tracking (fire-and-forget) ───────────────────────────────────

async function trackUsage(userId: string): Promise<void> {
  try {
    await executeWrite(
      `INSERT INTO ai_usage_stats (user_id, total_requests, last_request_at)
       VALUES (?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         total_requests  = total_requests + 1,
         last_request_at = NOW()`,
      [userId],
    );
  } catch (err) {
    logger.warn({ err, userId }, 'AI usage stat update failed');
  }
}

// ─── Admin: global config management ─────────────────────────────────────────

export async function updateGlobalConfig(
  patch: Partial<Pick<GlobalConfig, 'aiEnabled' | 'hourlyLimit' | 'dailyLimit'>>,
  adminId: string,
): Promise<GlobalConfig> {
  const current = await getGlobalConfig();

  const next: GlobalConfig = {
    aiEnabled:   patch.aiEnabled   ?? current.aiEnabled,
    hourlyLimit: patch.hourlyLimit ?? current.hourlyLimit,
    dailyLimit:  patch.dailyLimit  ?? current.dailyLimit,
  };

  await executeWrite(
    `INSERT INTO ai_rate_config (id, ai_enabled, hourly_limit, daily_limit, updated_by)
     VALUES (1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ai_enabled   = VALUES(ai_enabled),
       hourly_limit = VALUES(hourly_limit),
       daily_limit  = VALUES(daily_limit),
       updated_by   = VALUES(updated_by)`,
    [next.aiEnabled ? 1 : 0, next.hourlyLimit, next.dailyLimit, adminId],
  );

  await invalidateGlobalConfig();
  logger.info({ next, adminId }, 'AI global rate config updated');
  return next;
}

// ─── Admin: per-user limit management ────────────────────────────────────────

export interface UpsertUserLimitsInput {
  isBlocked?:   boolean;
  isUnlimited?: boolean;
  hourlyLimit?: number | null;
  dailyLimit?:  number | null;
  planType?:    string;
  blockReason?: string | null;
}

export async function upsertUserLimits(
  userId: string,
  input: UpsertUserLimitsInput,
  adminId: string,
): Promise<void> {
  await executeWrite(
    `INSERT INTO ai_user_limits
       (user_id, is_blocked, is_unlimited, hourly_limit, daily_limit, plan_type, block_reason, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_blocked   = COALESCE(VALUES(is_blocked),   is_blocked),
       is_unlimited = COALESCE(VALUES(is_unlimited), is_unlimited),
       hourly_limit = VALUES(hourly_limit),
       daily_limit  = VALUES(daily_limit),
       plan_type    = COALESCE(VALUES(plan_type),    plan_type),
       block_reason = VALUES(block_reason),
       updated_by   = VALUES(updated_by)`,
    [
      userId,
      input.isBlocked   != null ? (input.isBlocked   ? 1 : 0) : null,
      input.isUnlimited != null ? (input.isUnlimited ? 1 : 0) : null,
      input.hourlyLimit ?? null,
      input.dailyLimit  ?? null,
      input.planType    ?? null,
      input.blockReason ?? null,
      adminId,
    ],
  );
  await invalidateUserLimits(userId);
}

export async function blockUser(userId: string, reason: string, adminId: string): Promise<void> {
  await upsertUserLimits(userId, { isBlocked: true, blockReason: reason }, adminId);
  logger.info({ userId, adminId, reason }, 'AI user blocked');
}

export async function unblockUser(userId: string, adminId: string): Promise<void> {
  await upsertUserLimits(userId, { isBlocked: false, blockReason: null }, adminId);
  logger.info({ userId, adminId }, 'AI user unblocked');
}

export async function resetUserCounters(userId: string, adminId: string): Promise<void> {
  await resetCounters(userId);
  logger.info({ userId, adminId }, 'AI rate limit counters reset');
}

// ─── Admin: usage analytics ───────────────────────────────────────────────────

export interface UsageAnalyticsRow {
  user_id: string;
  username: string;
  full_name: string | null;
  total_requests: number;
  last_request_at: string | null;
  hourlyCount: number;
  dailyCount: number;
  plan_type: string;
  is_blocked: number;
  is_unlimited: number;
}

export async function getUsageAnalytics(limit = 50): Promise<UsageAnalyticsRow[]> {
  // Embed LIMIT directly — mysql2 prepared statements misfire on LIMIT ?
  // when the LEFT JOIN returns TINYINT(1) columns (ER_WRONG_ARGUMENTS).
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = await executeSelect<{
    user_id: string;
    username: string;
    full_name: string | null;
    total_requests: number;
    last_request_at: string | null;
    plan_type: string | null;
    is_blocked: number | null;
    is_unlimited: number | null;
  }>(
    `SELECT
       s.user_id,
       IFNULL(u.username,  s.user_id) AS username,
       u.full_name,
       s.total_requests,
       s.last_request_at,
       IFNULL(l.plan_type,    'standard') AS plan_type,
       IFNULL(l.is_blocked,   0)          AS is_blocked,
       IFNULL(l.is_unlimited, 0)          AS is_unlimited
     FROM ai_usage_stats s
     LEFT JOIN app_users      u ON u.id       = s.user_id
     LEFT JOIN ai_user_limits l ON l.user_id  = s.user_id
     ORDER BY s.total_requests DESC
     LIMIT ${safeLimit}`,
    [],
  );

  // Enrich with live Redis counters (parallel)
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const { hourlyCount, dailyCount } = await getCounters(r.user_id);
      return {
        user_id:         r.user_id,
        username:        r.username,
        full_name:       r.full_name ?? null,
        total_requests:  r.total_requests,
        last_request_at: r.last_request_at,
        hourlyCount,
        dailyCount,
        plan_type:       r.plan_type   ?? 'standard',
        is_blocked:      r.is_blocked  ?? 0,
        is_unlimited:    r.is_unlimited ?? 0,
      };
    }),
  );

  return enriched;
}

export async function getUserUsage(userId: string): Promise<UsageAnalyticsRow | null> {
  const rows = await executeSelect<{
    user_id: string;
    username: string;
    full_name: string | null;
    total_requests: number;
    last_request_at: string | null;
    plan_type: string | null;
    is_blocked: number | null;
    is_unlimited: number | null;
  }>(
    `SELECT
       s.user_id,
       IFNULL(u.username,  s.user_id) AS username,
       u.full_name,
       s.total_requests,
       s.last_request_at,
       IFNULL(l.plan_type,    'standard') AS plan_type,
       IFNULL(l.is_blocked,   0)          AS is_blocked,
       IFNULL(l.is_unlimited, 0)          AS is_unlimited
     FROM ai_usage_stats s
     LEFT JOIN app_users      u ON u.id       = s.user_id
     LEFT JOIN ai_user_limits l ON l.user_id  = s.user_id
     WHERE s.user_id = ?`,
    [userId],
  );

  if (!rows[0]) return null;

  const { hourlyCount, dailyCount } = await getCounters(userId);
  const r = rows[0];

  return {
    user_id:         r.user_id,
    username:        r.username,
    full_name:       r.full_name ?? null,
    total_requests:  r.total_requests,
    last_request_at: r.last_request_at,
    hourlyCount,
    dailyCount,
    plan_type:       r.plan_type   ?? 'standard',
    is_blocked:      r.is_blocked  ?? 0,
    is_unlimited:    r.is_unlimited ?? 0,
  };
}

