/**
 * AI Rate Limit Middleware (Fastify preHandler)
 *
 * Must be registered AFTER authenticateRequest so request.user is available.
 *
 * Bypass rules (evaluated in order):
 *   1. Admin role    → always allowed, no counters touched
 *   2. Unlimited plan → allowed, counters skipped
 *   3. Blocked user  → 403
 *   4. AI disabled   → 503
 *   5. Hourly limit  → 429
 *   6. Daily limit   → 429
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkAndIncrementLimit } from '../ai/rate-limit/service.js';
import { logger } from '../utils/logger.js';

export async function checkAiRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;
  if (!user) {
    // Should never happen — auth middleware runs before this
    return reply.status(401).send({ success: false, error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  let result;
  try {
    result = await checkAndIncrementLimit(user.id, user.role);
  } catch (err) {
    // Rate limit service failure must never hard-block the user — fail open with a warning
    logger.error({ err, userId: user.id }, 'AI rate limit check failed — failing open');
    return;
  }

  if (result.allowed) return; // proceed to AI handler

  const statusCode = result.code === 'USER_BLOCKED'
    ? 403
    : result.code === 'AI_DISABLED'
      ? 503
      : 429;

  return reply.status(statusCode).send({
    success: false,
    error: result.message,
    code: result.code,
    usage: {
      hourlyCount: result.hourlyCount,
      hourlyLimit: result.hourlyLimit,
      dailyCount:  result.dailyCount,
      dailyLimit:  result.dailyLimit,
    },
  });
}
