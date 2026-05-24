/**
 * Dashboard widget routes.
 *
 *   GET    /dashboard/widgets                 List widget configs
 *   GET    /dashboard/widgets/:key            One widget config
 *   PUT    /dashboard/widgets/:key            Upsert widget config (admin)
 *   DELETE /dashboard/widgets/:key            Remove a widget (admin)
 *   GET    /dashboard/widgets/:key/data       Execute the configured tool and
 *                                             return normalised rows + count
 */

import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import {
  listWidgets,
  getWidget,
  upsertWidget,
  deleteWidget,
  executeWidget,
  type UpsertWidgetInput,
} from '../../dashboard/widgets.js';
import { v4 as uuidv4 } from 'uuid';
import type { McpToolContext } from '../../types/index.js';

export async function dashboardWidgetRoutes(fastify: FastifyInstance): Promise<void> {
  // ── List widgets ────────────────────────────────────────────────────────────
  fastify.get('/dashboard/widgets', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List all dashboard widget configurations',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async () => {
    const widgets = await listWidgets();
    return { widgets, count: widgets.length };
  });

  // ── Get one widget ──────────────────────────────────────────────────────────
  fastify.get<{ Params: { key: string } }>('/dashboard/widgets/:key', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get one widget configuration',
      params: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const widget = await getWidget(request.params.key);
    if (!widget) {
      return reply.status(404).send({ error: 'Widget not found', code: 'WIDGET_NOT_FOUND' });
    }
    return widget;
  });

  // ── Upsert widget (admin) ───────────────────────────────────────────────────
  fastify.put<{
    Params: { key: string };
    Body: Omit<UpsertWidgetInput, 'widget_key' | 'updated_by'>;
  }>('/dashboard/widgets/:key', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Create or update a widget configuration (admin)',
      params: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string', minLength: 1, maxLength: 64 } },
      },
      body: {
        type: 'object',
        required: ['display_label', 'tool_name', 'args'],
        properties: {
          display_label: { type: 'string', minLength: 1, maxLength: 128 },
          tool_name: { type: 'string', minLength: 1, maxLength: 128 },
          args: { type: 'object' },
          count_args: { type: ['object', 'null'] },
          column_map: { type: ['object', 'null'] },
          description: { type: ['string', 'null'], maxLength: 255 },
          enabled: { type: 'boolean' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request) => {
    const widget = await upsertWidget({
      widget_key: request.params.key,
      display_label: request.body.display_label,
      tool_name: request.body.tool_name,
      args: request.body.args,
      count_args: request.body.count_args ?? null,
      column_map: request.body.column_map ?? null,
      description: request.body.description ?? null,
      enabled: request.body.enabled,
      updated_by: request.user.id,
    });
    return widget;
  });

  // ── Delete widget (admin) ───────────────────────────────────────────────────
  fastify.delete<{ Params: { key: string } }>('/dashboard/widgets/:key', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Delete a widget configuration (admin)',
      params: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const ok = await deleteWidget(request.params.key);
    if (!ok) {
      return reply.status(404).send({ error: 'Widget not found', code: 'WIDGET_NOT_FOUND' });
    }
    return { success: true };
  });

  // ── Execute widget (returns rendered data) ──────────────────────────────────
  fastify.get<{ Params: { key: string } }>('/dashboard/widgets/:key/data', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Execute the widget\'s configured tool and return normalised data',
      params: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const ctx: McpToolContext = {
      caller: request.user,
      requestId: request.requestId ?? uuidv4(),
      timestamp: new Date(),
    };

    try {
      const result = await executeWidget(request.params.key, ctx);
      return result;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return reply.status(status).send({
        error: (err as Error).message,
        code: (err as { code?: string }).code ?? 'WIDGET_ERROR',
      });
    }
  });
}
