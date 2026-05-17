/**
 * MCP Server — the core Model Context Protocol integration.
 *
 * This module creates and configures the MCP Server instance, registers
 * all tool handlers, and exposes helper methods for Fastify route
 * integration via SSE transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';

import { toolRegistry } from './registry.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isAppError } from '../utils/errors.js';
import type { McpToolContext, Role } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

// ─── Session store ────────────────────────────────────────────────────────────

const sessions = new Map<string, SSEServerTransport>();

// ─── Per-session server factory ───────────────────────────────────────────────
// The MCP SDK Server can only be connected to one transport at a time.
// We create a fresh Server instance per SSE connection to support multiple clients.

function createMcpServer(): Server {
  const server = new Server(
    {
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  // ── Tool listing ────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = toolRegistry.listTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    };
  });

  // ── Tool execution ──────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    const ctx: McpToolContext = {
      caller: { id: 'mcp-system', role: 'service' as Role, name: 'MCP System' },
      requestId: uuidv4(),
      timestamp: new Date(),
    };

    try {
      const result = await toolRegistry.executeTool(name, args, ctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        isError: false,
        _meta: {
          cached: result.cached,
          executionMs: result.executionMs,
          rowCount: result.rowCount,
        },
      };
    } catch (err) {
      logger.error({ err, tool: name }, 'MCP tool execution error');
      if (isAppError(err)) throw new McpError(ErrorCode.InternalError, err.message);
      throw new McpError(ErrorCode.InternalError, 'An unexpected error occurred');
    }
  });

  return server;
}

// Keep a reference for health checks / backwards compat
export const mcpServer = createMcpServer();

// ─── SSE Transport helpers (used by Fastify routes) ───────────────────────────

/**
 * Open a new SSE session.
 * The client connects to this endpoint to receive SSE events.
 */
export async function handleSseConnection(
  _req: IncomingMessage,
  res: ServerResponse,
  messagesEndpoint: string,
): Promise<void> {
  const transport = new SSEServerTransport(messagesEndpoint, res);
  const server = createMcpServer();

  sessions.set(transport.sessionId, transport);
  logger.info({ sessionId: transport.sessionId }, 'MCP SSE session opened');

  await server.connect(transport);

  res.on('close', () => {
    sessions.delete(transport.sessionId);
    logger.info({ sessionId: transport.sessionId }, 'MCP SSE session closed');
  });
}

/**
 * Route incoming POST messages to the correct session transport.
 */
export async function handleSseMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): Promise<void> {
  const transport = sessions.get(sessionId);
  if (!transport) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  await transport.handlePostMessage(req, res);
}

export function getActiveSessions(): string[] {
  return [...sessions.keys()];
}
