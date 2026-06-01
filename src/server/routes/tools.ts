/**
 * Tool management and execution REST routes.
 *
 * GET  /tools                — List available tools
 * POST /tools/:name/execute  — Execute a specific tool via REST
 * POST /tools/refresh        — Re-generate tools from DB schema (admin)
 * POST /ai/chat              — Agentic chat with automatic tool dispatching (OpenAI)
 */

import type { FastifyInstance } from 'fastify';
import { toolRegistry, getToolHealthStats } from '../../mcp/registry.js';
import { refreshTools } from '../../mcp/generator.js';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole, checkToolPermission } from '../../middleware/permission.js';
import { chatWithTools } from '../../openai/converter.js';
import { env } from '../../config/env.js';
import { executeSelect, executeWrite } from '../../database/client.js';
import { v4 as uuidv4 } from 'uuid';
import type { McpToolContext } from '../../types/index.js';

export async function toolRoutes(fastify: FastifyInstance): Promise<void> {
  // ── List tools ───────────────────────────────────────────────────────────────
  fastify.get('/tools', {
    schema: {
      tags: ['Tools'],
      summary: 'List all available MCP tools for the authenticated user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request) => {
    const tools = toolRegistry.listTools(request.user.role);
    return { tools, count: tools.length };
  });

  // ── Execute a tool ───────────────────────────────────────────────────────────
  fastify.post<{
    Params: { name: string };
    Body: { args?: Record<string, unknown> };
  }>('/tools/:name/execute', {
    schema: {
      tags: ['Tools'],
      summary: 'Execute a named MCP tool',
      params: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          args: { type: 'object', description: 'Tool input arguments' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, checkToolPermission],
  }, async (request, reply) => {
    const { name } = request.params;
    const args = request.body?.args ?? {};

    const ctx: McpToolContext = {
      caller: request.user,
      requestId: request.requestId ?? uuidv4(),
      timestamp: new Date(),
    };

    try {
      const result = await toolRegistry.executeTool(name, args, ctx);
      return reply.send({
        tool: name,
        ...result,
        executedAt: ctx.timestamp.toISOString(),
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return reply.status(status).send({
        error: (err as Error).message,
        code: (err as { code?: string }).code ?? 'TOOL_ERROR',
        tool: name,
      });
    }
  });

  // ── Tool health stats (Rule 9 + 14) ─────────────────────────────────────────
  fastify.get('/tools/health', {
    schema: {
      tags: ['Tools'],
      summary: 'MCP tool health — success rate, latency, retries',
      description:
        'Returns in-process health counters for every MCP tool that has been called ' +
        'since the server started. Resets on restart.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async () => {
    const stats = getToolHealthStats();
    const totalCalls = stats.reduce((n, s) => n + s.totalCallCount, 0);
    const totalFailures = stats.reduce((n, s) => n + s.failureCount, 0);
    const overallSuccessRate = totalCalls === 0 ? 1 : +((totalCalls - totalFailures) / totalCalls).toFixed(4);
    return {
      overallSuccessRate,
      totalCallCount: totalCalls,
      totalFailureCount: totalFailures,
      tools: stats,
      generatedAt: new Date().toISOString(),
    };
  });

  // ── Refresh tools from schema ─────────────────────────────────────────────────
  fastify.post('/tools/refresh', {
    schema: {
      tags: ['Tools'],
      summary: 'Re-scan the database schema and regenerate dynamic tools (admin)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (_req, reply) => {
    const count = await refreshTools();
    return reply.send({ message: 'Tools refreshed', generatedCount: count });
  });

  // ── Delete a tool ────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { name: string } }>('/tools/:name', {
    schema: {
      tags: ['Tools'],
      summary: 'Delete a tool (admin only)',
      params: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const { name } = request.params;

    try {
      // Check if tool exists
      const tools = toolRegistry.listTools('admin');
      const tool = tools.find(t => t.name === name);

      if (!tool) {
        return reply.status(404).send({ error: 'Tool not found', code: 'NOT_FOUND' });
      }

      // Remove from registry
      const removed = toolRegistry.unregister(name);
      if (!removed) {
        return reply.status(404).send({ error: 'Tool not found', code: 'NOT_FOUND' });
      }

      return reply.status(200).send({
        message: `Tool "${name}" deleted`,
        tool: name,
      });
    } catch (err) {
      return reply.status(500).send({
        error: (err as Error).message,
        code: 'DELETE_ERROR',
      });
    }
  });

  // ── AI chat endpoint ──────────────────────────────────────────────────────────
  fastify.post<{ Body: { message: string; conversationId?: string } }>('/ai/chat', {
    schema: {
      tags: ['AI'],
      summary: 'Send a natural language message and get an AI response with tool use',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 4000 },
          conversationId: { type: 'string' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { message, conversationId: incomingConvId } = request.body;
    const userId = request.user.id;

    try {
      // ── Resolve or create conversation ──────────────────────────────────────
      let conversationId = incomingConvId ?? null;

      if (conversationId) {
        // Verify it belongs to this user
        const [existing] = await executeSelect<{ id: string }>(
          'SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?',
          [conversationId, userId],
        );
        if (!existing) {
          return reply.status(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });
        }
      } else {
        // Create a new conversation titled from the first message
        conversationId = uuidv4();
        const title = message.slice(0, 80);
        await executeWrite(
          'INSERT INTO chat_conversations (id, user_id, title) VALUES (?, ?, ?)',
          [conversationId, userId, title],
        );
      }

      // ── Persist user message ─────────────────────────────────────────────────
      const userMsgId = uuidv4();
      await executeWrite(
        'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
        [userMsgId, conversationId, 'user', message],
      );

      // ── Call AI ──────────────────────────────────────────────────────────────
      if (!env.OPENAI_API_KEY) {
        return reply.status(503).send({
          error: 'AI chat is not available: OPENAI_API_KEY is not configured on the server.',
          code: 'OPENAI_NOT_CONFIGURED',
        });
      }

      const result = await chatWithTools({
        userMessage: message,
        callerId: request.user.id,
        callerRole: request.user.role,
        callerName: request.user.name,
      });

      // ── Persist assistant message ────────────────────────────────────────────
      const assistantMsgId = uuidv4();
      const toolCallsJson = result.messages
        .filter(m => m.role === 'assistant' && Array.isArray((m as { tool_calls?: unknown[] }).tool_calls))
        .flatMap(m => (m as { tool_calls?: { function?: { name?: string } }[] }).tool_calls ?? [])
        .map(tc => tc?.function?.name)
        .filter(Boolean);

      await executeWrite(
        'INSERT INTO chat_messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)',
        [assistantMsgId, conversationId, 'assistant', result.reply,
          toolCallsJson.length ? JSON.stringify(toolCallsJson) : null],
      );

      // ── Touch conversation updated_at ────────────────────────────────────────
      await executeWrite(
        'UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId],
      );

      return reply.send({
        reply: result.reply,
        toolCallsExecuted: result.toolCallsExecuted,
        conversationId,
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return reply.status(status).send({
        error: (err as Error).message,
        code: 'AI_CHAT_ERROR',
      });
    }
  });
}
