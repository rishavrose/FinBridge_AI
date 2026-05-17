/**
 * MCP SSE routes.
 *
 * GET  /mcp/sse      — Client opens long-lived SSE connection
 * POST /mcp/messages — Client sends JSON-RPC messages to the server
 * GET  /mcp/sessions — List active sessions (admin only)
 */

import type { FastifyInstance } from 'fastify';
import { Readable } from 'stream';
import type { IncomingMessage } from 'http';
import { handleSseConnection, handleSseMessage, getActiveSessions } from '../../mcp/server.js';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  // ── SSE connection endpoint ──────────────────────────────────────────────────
  fastify.get('/mcp/sse', {
    schema: {
      tags: ['MCP'],
      summary: 'Open an MCP SSE connection',
      description:
        'AI clients (Claude, OpenAI, etc.) connect here to establish an SSE session ' +
        'for real-time MCP communication.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    // Hijack the raw response — SSE is a long-lived stream, Fastify must not touch it
    reply.hijack();

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    await handleSseConnection(request.raw, reply.raw, '/mcp/messages');
  });

  // ── Message endpoint ─────────────────────────────────────────────────────────
  fastify.post<{ Querystring: { sessionId: string } }>('/mcp/messages', {
    schema: {
      tags: ['MCP'],
      summary: 'Send an MCP message to an active session',
      querystring: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string', description: 'The SSE session ID returned on connection' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    // Hijack — the MCP SDK writes its own response directly to res.raw
    reply.hijack();
    const { sessionId } = request.query;

    // Fastify's body parser already consumed req; reconstruct a readable stream
    // from the parsed body so the MCP SDK can read it normally.
    const bodyStr = JSON.stringify(request.body);
    const fakeReq = Object.assign(
      Readable.from([Buffer.from(bodyStr)]),
      {
        headers: request.raw.headers,
        method: request.raw.method,
        url: request.raw.url,
      },
    ) as unknown as IncomingMessage;

    await handleSseMessage(fakeReq, reply.raw, sessionId);
  });

  // ── Active sessions (admin) ──────────────────────────────────────────────────
  fastify.get('/mcp/sessions', {
    schema: {
      tags: ['MCP'],
      summary: 'List active MCP sessions (admin only)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async () => {
    const sessions = getActiveSessions();
    return { sessions, count: sessions.length };
  });
}
