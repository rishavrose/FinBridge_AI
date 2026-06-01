/**
 * Tenant Scope Resolver
 *
 * Resolves a logged-in app user's allowed `mapped_user_id` values, which are
 * then injected as a forced WHERE filter on every business-table query.
 *
 * Sources, in priority order:
 *   1. Redis cache  — 5 min TTL, keyed by appUserId
 *   2. MySQL        — user_data_scope table, joined to current mode
 *
 * Mode resolution:
 *   - Runtime override in Redis (admin-toggle, key `scope:mode`) → wins
 *   - Else: env.AI_SCOPE_MODE
 *
 * Admins (role === 'admin') ALWAYS resolve to `unrestricted: true`, regardless
 * of mode — they see everything by design.
 */

import { getRedisClient } from '../../cache/client.js';
import { executeSelect } from '../../database/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { AccessScope, Role } from '../../types/index.js';

const SCOPE_CACHE_PREFIX = 'scope:user:';
const SCOPE_CACHE_TTL_SECONDS = 300;
const SCOPE_MODE_KEY = 'scope:mode';
const SCOPE_MODE_TTL_SECONDS = 86_400;

type ScopeMode = 'RESTRICTED' | 'GLOBAL';

// ─── Mode (runtime-overridable) ──────────────────────────────────────────────

export async function getScopeMode(): Promise<ScopeMode> {
  try {
    const override = await getRedisClient().get(SCOPE_MODE_KEY);
    if (override === 'RESTRICTED' || override === 'GLOBAL') return override;
  } catch (err) {
    logger.debug({ err }, 'scope: mode lookup failed, using env default');
  }
  return env.AI_SCOPE_MODE as ScopeMode;
}

export async function setScopeMode(mode: ScopeMode): Promise<void> {
  await getRedisClient().setex(SCOPE_MODE_KEY, SCOPE_MODE_TTL_SECONDS, mode);
  logger.info({ mode }, 'scope: mode updated at runtime');
}

// ─── Resolution ──────────────────────────────────────────────────────────────

interface MappingRow { mapped_user_id: string }

/**
 * Returns the access scope for a caller. Cheap to call once per request and
 * pass into McpToolContext.scope.
 *
 * Throws nothing — callers MUST inspect `unrestricted` and `mappedUserIds`
 * to decide whether to allow or deny a business-table query.
 */
export async function resolveScope(
  appUserId: string,
  role: Role,
): Promise<AccessScope> {
  // Admin always unrestricted
  if (role === 'admin') {
    return { unrestricted: true, mappedUserIds: [], appUserId, mode: await getScopeMode() };
  }

  const mode = await getScopeMode();

  // GLOBAL mode = no enforcement for anyone
  if (mode === 'GLOBAL') {
    return { unrestricted: true, mappedUserIds: [], appUserId, mode };
  }

  // RESTRICTED mode — load mappings
  const mappedUserIds = await loadMappings(appUserId);
  return { unrestricted: false, mappedUserIds, appUserId, mode };
}

async function loadMappings(appUserId: string): Promise<string[]> {
  const redis = getRedisClient();
  const cacheKey = `${SCOPE_CACHE_PREFIX}${appUserId}`;

  // L1: Redis
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      try {
        const parsed = JSON.parse(cached) as string[];
        if (Array.isArray(parsed)) return parsed;
      } catch { /* fall through */ }
    }
  } catch (err) {
    logger.debug({ err, appUserId }, 'scope: redis read failed');
  }

  // L2: MySQL
  let rows: MappingRow[] = [];
  try {
    rows = await executeSelect<MappingRow>(
      'SELECT mapped_user_id FROM user_data_scope WHERE app_user_id = ?',
      [appUserId],
    );
  } catch (err) {
    logger.warn({ err, appUserId }, 'scope: db lookup failed — treating as empty mapping');
  }

  const mappedUserIds = rows.map((r) => r.mapped_user_id).filter(Boolean);

  // Warm cache (even for empty arrays — avoid hammering DB for unmapped users)
  try {
    await redis.setex(cacheKey, SCOPE_CACHE_TTL_SECONDS, JSON.stringify(mappedUserIds));
  } catch { /* non-fatal */ }

  return mappedUserIds;
}

// ─── Cache invalidation ──────────────────────────────────────────────────────

export async function invalidateScopeCache(appUserId: string): Promise<void> {
  try {
    await getRedisClient().del(`${SCOPE_CACHE_PREFIX}${appUserId}`);
  } catch { /* non-fatal */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when a RESTRICTED-mode caller has no mappings and must be
 * denied access to business data. Callers use this to short-circuit with a 403.
 */
export function isEmptyRestrictedScope(scope: AccessScope): boolean {
  return !scope.unrestricted && scope.mappedUserIds.length === 0;
}
