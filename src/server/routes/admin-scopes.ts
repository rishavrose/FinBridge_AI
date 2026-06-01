/**
 * Admin endpoints for managing tenant scope mappings + the global scope mode.
 *
 * All routes require role >= admin. Mutations invalidate the affected user's
 * scope cache so the next request sees the new mapping immediately.
 *
 *   GET    /admin/scope/mode                       — current mode
 *   POST   /admin/scope/mode                       — flip mode at runtime
 *   GET    /admin/scope/users/:appUserId           — list mappings for one user
 *   POST   /admin/scope/users/:appUserId           — add a mapping
 *   DELETE /admin/scope/users/:appUserId/:mapId    — remove a mapping
 *   GET    /admin/scope/me                         — resolve current caller's scope (debug)
 */

import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import { executeSelect, executeWrite } from '../../database/client.js';
import {
  resolveScope,
  getScopeMode,
  setScopeMode,
  invalidateScopeCache,
} from '../../auth/scope/resolver.js';
import { logger } from '../../utils/logger.js';
import type { Role } from '../../types/index.js';

interface ScopeRow {
  id: string;
  app_user_id: string;
  mapped_user_id: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export async function adminScopeRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET current scope mode ─────────────────────────────────────────────────
  fastify.get('/admin/scope/mode', {
    schema: {
      tags: ['Admin'],
      summary: 'Get current scope mode (GLOBAL or RESTRICTED)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async () => {
    return { mode: await getScopeMode() };
  });

  // ── POST set scope mode ────────────────────────────────────────────────────
  fastify.post<{ Body: { mode: 'GLOBAL' | 'RESTRICTED' } }>('/admin/scope/mode', {
    schema: {
      tags: ['Admin'],
      summary: 'Set scope mode at runtime (persisted in Redis)',
      body: {
        type: 'object',
        required: ['mode'],
        properties: { mode: { type: 'string', enum: ['GLOBAL', 'RESTRICTED'] } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    await setScopeMode(request.body.mode);
    logger.info({ actor: request.user.id, mode: request.body.mode }, 'scope: mode changed by admin');
    return reply.status(200).send({ mode: request.body.mode });
  });

  // ── GET mappings for a user ────────────────────────────────────────────────
  fastify.get<{ Params: { appUserId: string } }>('/admin/scope/users/:appUserId', {
    schema: {
      tags: ['Admin'],
      summary: 'List tenant scope mappings for an app user',
      params: {
        type: 'object',
        required: ['appUserId'],
        properties: { appUserId: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const rows = await executeSelect<ScopeRow>(
      `SELECT id, app_user_id, mapped_user_id, notes, created_by, created_at
       FROM user_data_scope WHERE app_user_id = ? ORDER BY created_at DESC`,
      [request.params.appUserId],
    );
    return reply.status(200).send({ mappings: rows });
  });

  // ── POST add mapping ───────────────────────────────────────────────────────
  fastify.post<{
    Params: { appUserId: string };
    Body: { mappedUserId: string; notes?: string };
  }>('/admin/scope/users/:appUserId', {
    schema: {
      tags: ['Admin'],
      summary: 'Add a mapped_user_id to an app user',
      params: {
        type: 'object',
        required: ['appUserId'],
        properties: { appUserId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['mappedUserId'],
        properties: {
          mappedUserId: { type: 'string', minLength: 1, maxLength: 64 },
          notes: { type: 'string', maxLength: 255 },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const id = uuidv4();
    try {
      await executeWrite(
        `INSERT INTO user_data_scope (id, app_user_id, mapped_user_id, notes, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, request.params.appUserId, request.body.mappedUserId, request.body.notes ?? null, request.user.id],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ER_DUP_ENTRY') {
        return reply.status(409).send({ error: 'Mapping already exists', code: 'DUP_MAPPING' });
      }
      throw err;
    }
    await invalidateScopeCache(request.params.appUserId);
    return reply.status(201).send({ id, appUserId: request.params.appUserId, mappedUserId: request.body.mappedUserId });
  });

  // ── DELETE remove a single mapping ─────────────────────────────────────────
  fastify.delete<{ Params: { appUserId: string; mapId: string } }>(
    '/admin/scope/users/:appUserId/:mapId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Remove a single tenant mapping',
        params: {
          type: 'object',
          required: ['appUserId', 'mapId'],
          properties: { appUserId: { type: 'string' }, mapId: { type: 'string' } },
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticateRequest, requireRole('admin')],
    },
    async (request, reply) => {
      await executeWrite(
        `DELETE FROM user_data_scope WHERE id = ? AND app_user_id = ?`,
        [request.params.mapId, request.params.appUserId],
      );
      await invalidateScopeCache(request.params.appUserId);
      return reply.status(204).send();
    },
  );

  // ── GET caller's current resolved scope (debug / self-check) ───────────────
  fastify.get('/admin/scope/me', {
    schema: {
      tags: ['Admin'],
      summary: 'Inspect the caller’s resolved scope (debug)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request) => {
    const scope = await resolveScope(request.user.id, request.user.role as Role);
    return { scope };
  });
}
