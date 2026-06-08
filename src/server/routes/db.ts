/**
 * Dynamic Database Connection Routes
 *
 * POST   /db/test                   — Test a DB connection (no storage)
 * POST   /db/connect                — Connect, encrypt, store, scan schema, generate tools
 * GET    /db/connections            — List stored connections (metadata only)
 * DELETE /db/connections/:id        — Remove a connection
 * GET    /db/connections/:id/schema — Re-scan schema for a connection
 * POST   /db/connections/:id/refresh— Re-generate MCP tools for a connection
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import {
  testDbConnection,
  storeConnection,
  listStoredConnections,
  removeConnection,
  scanConnectionSchema,
  generateToolsForConnection,
  getStoredConnection,
} from '../../database/connection-manager.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

// ─── Input validation schemas ─────────────────────────────────────────────────

const dbConfigSchema = z.object({
  host:           z.string().min(1).max(253),
  port:           z.number().int().min(1).max(65535).default(3306),
  database:       z.string().min(1).max(64),
  username:       z.string().min(1).max(64),
  password:       z.string().min(1).max(256),
  ssl:            z.boolean().default(false),
  name:           z.string().max(128).optional(),
  selectedTables: z.array(z.string().min(1).max(64)).optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function dbRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Test connectivity only ────────────────────────────────────────────────────
  fastify.post<{ Body: unknown }>('/db/test', {
    schema: {
      tags: ['Database'],
      summary: 'Test a MySQL database connection (no credentials stored)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['host', 'database', 'username', 'password'],
        properties: {
          host:     { type: 'string' },
          port:     { type: 'number', default: 3306 },
          database: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          ssl:      { type: 'boolean', default: false },
        },
      },
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const parsed = dbConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await testDbConnection(parsed.data);
    // Always return 200 — success/failure is signalled via the `success` field
    return reply.status(200).send(result);
  });

  // ── Connect: store + scan + generate tools ────────────────────────────────────
  fastify.post<{ Body: unknown }>('/db/connect', {
    schema: {
      tags: ['Database'],
      summary: 'Store encrypted DB credentials, scan schema, and generate MCP tools',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['host', 'database', 'username', 'password'],
        properties: {
          host:     { type: 'string' },
          port:     { type: 'number', default: 3306 },
          database: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          ssl:      { type: 'boolean', default: false },
          name:     { type: 'string' },
          selectedTables: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const parsed = dbConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // 1. Test connectivity first
    const testResult = await testDbConnection(parsed.data);
    if (!testResult.success) {
      return reply.status(502).send({
        error: 'Database connection failed',
        detail: testResult.error,
        latencyMs: testResult.latencyMs,
      });
    }

    // 2. Store encrypted credentials
    let credential;
    try {
      credential = await storeConnection(parsed.data, request.user.id);
    } catch (err) {
      logger.error({ err }, 'storeConnection failed — cannot persist DB credentials');
      return reply.status(503).send({
        error: 'Could not securely store the connection. The credential encryption key is missing or misconfigured on the server.',
        code: 'CREDENTIAL_STORE_FAILED',
      });
    }

    // 3. Scan schema + generate tools (only selected tables if specified)
    let toolSummary;
    try {
      toolSummary = await generateToolsForConnection(credential.id, parsed.data.selectedTables);
    } catch (err) {
      logger.warn({ connectionId: credential.id, err }, 'Tool generation failed after connect');
      toolSummary = null;
    }

    return reply.status(201).send({
      connectionId: credential.id,
      name: credential.name,
      database: credential.database,
      host: credential.host,
      port: credential.port,
      ssl: credential.ssl,
      createdAt: credential.createdAt,
      selectedTables: credential.selectedTables,
      connectionTest: {
        latencyMs: testResult.latencyMs,
        serverVersion: testResult.serverVersion,
        tablesFound: testResult.tablesFound,
      },
      toolSummary,
    });
  });

  // ── List stored connections ───────────────────────────────────────────────────
  fastify.get('/db/connections', {
    schema: {
      tags: ['Database'],
      summary: 'List all stored DB connections (metadata only — no credentials)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (_req, reply) => {
    const connections = await listStoredConnections();
    const withMeta = connections.map((c) => ({
      ...c,
      isMain: c.host === env.DB_HOST && c.database === env.DB_NAME,
    }));
    return reply.send({ connections: withMeta, count: withMeta.length });
  });

  // ── Remove a connection ───────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/db/connections/:id', {
    schema: {
      tags: ['Database'],
      summary: 'Remove a stored DB connection and release its pool',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;

    // Guard: prevent deletion of the app's own internal database connection
    const conn = await getStoredConnection(id);
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    if (
      conn.host === env.DB_HOST &&
      conn.database === env.DB_NAME
    ) {
      return reply.status(403).send({
        error: 'This is the main application database and cannot be removed.',
      });
    }

    const removed = await removeConnection(id);
    if (!removed) return reply.status(404).send({ error: 'Connection not found' });
    return reply.send({ message: 'Connection removed', id });
  });

  // ── Re-scan schema ────────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/db/connections/:id/schema', {
    schema: {
      tags: ['Database'],
      summary: 'Scan the schema for a stored DB connection',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const tables = await scanConnectionSchema(id);
      return reply.send({ connectionId: id, tableCount: tables.length, tables });
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // ── Refresh tools for a connection ────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { selectedTables?: string[] } }>('/db/connections/:id/refresh', {
    schema: {
      tags: ['Database'],
      summary: 'Re-generate MCP tools for a stored DB connection',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          selectedTables: { type: 'array', items: { type: 'string' } },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;
    const selectedTables = request.body?.selectedTables;
    try {
      const summary = await generateToolsForConnection(id, selectedTables);
      return reply.send({ message: 'Tools refreshed', ...summary });
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });
}
