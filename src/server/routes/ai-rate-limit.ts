/**
 * Admin AI Rate Limiting Routes
 *
 * All routes require admin role.  Prefix: /admin/ai
 *
 * Global config
 *   GET  /admin/ai/config          — read current global limits & toggle
 *   PUT  /admin/ai/config          — update global limits / toggle AI on/off
 *
 * Per-user management
 *   GET  /admin/ai/users/:userId/limits   — read user's limit overrides
 *   PUT  /admin/ai/users/:userId/limits   — set custom limits / plan / block
 *   POST /admin/ai/users/:userId/block    — block a user from AI
 *   POST /admin/ai/users/:userId/unblock  — unblock a user
 *   POST /admin/ai/users/:userId/reset    — reset Redis counters for a user
 *
 * Analytics
 *   GET  /admin/ai/usage                  — top users by request volume
 *   GET  /admin/ai/usage/:userId          — single-user usage detail
 */

import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import {
  getGlobalConfig,
  updateGlobalConfig,
  getUserLimits,
  upsertUserLimits,
  blockUser,
  unblockUser,
  resetUserCounters,
  getUsageAnalytics,
  getUserUsage,
} from '../../ai/rate-limit/service.js';

export async function aiRateLimitRoutes(fastify: FastifyInstance): Promise<void> {
  const adminGuard = [authenticateRequest, requireRole('admin')];

  // ── GET /admin/ai/config ──────────────────────────────────────────────────

  fastify.get('/admin/ai/config', {
    schema: {
      tags: ['Admin'],
      summary: 'Get global AI rate limit configuration',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            aiEnabled:   { type: 'boolean' },
            hourlyLimit: { type: 'number' },
            dailyLimit:  { type: 'number' },
          },
        },
      },
    },
    preHandler: adminGuard,
  }, async (_req, reply) => {
    const cfg = await getGlobalConfig();
    return reply.status(200).send(cfg);
  });

  // ── PUT /admin/ai/config ──────────────────────────────────────────────────

  fastify.put<{
    Body: { aiEnabled?: boolean; hourlyLimit?: number; dailyLimit?: number };
  }>('/admin/ai/config', {
    schema: {
      tags: ['Admin'],
      summary: 'Update global AI rate limit configuration',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          aiEnabled:   { type: 'boolean', description: 'Set false to disable AI globally (kill-switch)' },
          hourlyLimit: { type: 'number',  minimum: 1, description: 'Default max AI requests per user per hour' },
          dailyLimit:  { type: 'number',  minimum: 1, description: 'Default max AI requests per user per day' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success:     { type: 'boolean' },
            aiEnabled:   { type: 'boolean' },
            hourlyLimit: { type: 'number' },
            dailyLimit:  { type: 'number' },
          },
        },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    const updated = await updateGlobalConfig(request.body, request.user.id);
    return reply.status(200).send({ success: true, ...updated });
  });

  // ── GET /admin/ai/users/:userId/limits ────────────────────────────────────

  fastify.get<{ Params: { userId: string } }>('/admin/ai/users/:userId/limits', {
    schema: {
      tags: ['Admin'],
      summary: 'Get per-user AI rate limit overrides',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    const limits = await getUserLimits(request.params.userId);
    if (!limits) {
      return reply.status(200).send({
        userId: request.params.userId,
        note: 'No custom limits — using global defaults',
        isBlocked:   false,
        isUnlimited: false,
        hourlyLimit: null,
        dailyLimit:  null,
        planType:    'standard',
        blockReason: null,
      });
    }
    return reply.status(200).send({ userId: request.params.userId, ...limits });
  });

  // ── PUT /admin/ai/users/:userId/limits ────────────────────────────────────

  fastify.put<{
    Params: { userId: string };
    Body: {
      isBlocked?:   boolean;
      isUnlimited?: boolean;
      hourlyLimit?: number | null;
      dailyLimit?:  number | null;
      planType?:    string;
      blockReason?: string | null;
    };
  }>('/admin/ai/users/:userId/limits', {
    schema: {
      tags: ['Admin'],
      summary: 'Set per-user AI rate limit overrides',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          isBlocked:   { type: 'boolean', description: 'Block user from AI access' },
          isUnlimited: { type: 'boolean', description: 'Grant unlimited/premium access' },
          hourlyLimit: { type: ['number', 'null'], minimum: 1, description: 'Custom hourly limit; null = use global' },
          dailyLimit:  { type: ['number', 'null'], minimum: 1, description: 'Custom daily limit; null = use global' },
          planType:    { type: 'string',  enum: ['standard', 'premium', 'enterprise'] },
          blockReason: { type: ['string', 'null'] },
        },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    await upsertUserLimits(request.params.userId, request.body, request.user.id);
    return reply.status(200).send({ success: true });
  });

  // ── POST /admin/ai/users/:userId/block ────────────────────────────────────

  fastify.post<{
    Params: { userId: string };
    Body: { reason?: string };
  }>('/admin/ai/users/:userId/block', {
    schema: {
      tags: ['Admin'],
      summary: 'Block a user from making AI requests',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Optional reason shown to the user' },
        },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    const reason = request.body.reason ?? 'AI access suspended by administrator.';
    await blockUser(request.params.userId, reason, request.user.id);
    return reply.status(200).send({ success: true });
  });

  // ── POST /admin/ai/users/:userId/unblock ──────────────────────────────────

  fastify.post<{ Params: { userId: string } }>('/admin/ai/users/:userId/unblock', {
    schema: {
      tags: ['Admin'],
      summary: 'Unblock a user, restoring AI access',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    await unblockUser(request.params.userId, request.user.id);
    return reply.status(200).send({ success: true });
  });

  // ── POST /admin/ai/users/:userId/reset ────────────────────────────────────

  fastify.post<{ Params: { userId: string } }>('/admin/ai/users/:userId/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset Redis rate limit counters for a user (current window only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    await resetUserCounters(request.params.userId, request.user.id);
    return reply.status(200).send({ success: true });
  });

  // ── GET /admin/ai/usage ───────────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>('/admin/ai/usage', {
    schema: {
      tags: ['Admin'],
      summary: 'AI usage analytics — top users by lifetime request volume',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { limit: { type: 'string', description: 'Max rows (default 50, max 200)' } },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);
    const rows  = await getUsageAnalytics(limit);
    return reply.status(200).send({ rows, count: rows.length });
  });

  // ── GET /admin/ai/usage/:userId ───────────────────────────────────────────

  fastify.get<{ Params: { userId: string } }>('/admin/ai/usage/:userId', {
    schema: {
      tags: ['Admin'],
      summary: 'AI usage detail for a single user',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    preHandler: adminGuard,
  }, async (request, reply) => {
    const data = await getUserUsage(request.params.userId);
    if (!data) {
      return reply.status(404).send({ error: 'No usage data found for this user', code: 'NOT_FOUND' });
    }
    return reply.status(200).send(data);
  });
}
