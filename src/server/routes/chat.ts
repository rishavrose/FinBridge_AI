/**
 * Chat history REST routes.
 *
 * GET    /chat/conversations          — list the caller's conversations
 * POST   /chat/conversations          — create a new conversation
 * GET    /chat/conversations/:id      — get messages for a conversation
 * DELETE /chat/conversations/:id      — delete a conversation
 */

import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest } from '../../middleware/auth.js';
import { executeSelect, executeWrite } from '../../database/client.js';

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: string[] | null;  // JSON column — MySQL2 auto-parses to array
  created_at: Date;
}

export async function chatHistoryRoutes(fastify: FastifyInstance): Promise<void> {
  // ── List conversations ──────────────────────────────────────────────────────
  fastify.get('/chat/conversations', {
    schema: {
      tags: ['AI'],
      summary: 'List all conversations for the authenticated user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request) => {
    const rows = await executeSelect<ConversationRow>(
      `SELECT id, user_id, title, created_at, updated_at
         FROM chat_conversations
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 100`,
      [request.user.id],
    );
    return { conversations: rows };
  });

  // ── Create conversation ─────────────────────────────────────────────────────
  fastify.post<{ Body: { title?: string } }>('/chat/conversations', {
    schema: {
      tags: ['AI'],
      summary: 'Create a new chat conversation',
      body: {
        type: 'object',
        properties: { title: { type: 'string', maxLength: 255 } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const id = uuidv4();
    const title = (request.body?.title ?? 'New Chat').slice(0, 255);
    await executeWrite(
      'INSERT INTO chat_conversations (id, user_id, title) VALUES (?, ?, ?)',
      [id, request.user.id, title],
    );
    return reply.status(201).send({ id, title });
  });

  // ── Get conversation messages ───────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/chat/conversations/:id', {
    schema: {
      tags: ['AI'],
      summary: 'Get messages for a specific conversation',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    // Ensure conversation belongs to caller
    const [conv] = await executeSelect<ConversationRow>(
      'SELECT id, title, created_at, updated_at FROM chat_conversations WHERE id = ? AND user_id = ?',
      [request.params.id, request.user.id],
    );
    if (!conv) return reply.status(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });

    const messages = await executeSelect<MessageRow>(
      `SELECT id, role, content, tool_calls, created_at
         FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC`,
      [request.params.id],
    );

    return {
      conversation: conv,
      messages: messages.map(m => ({
        ...m,
        tool_calls: m.tool_calls ?? undefined,
      })),
    };
  });

  // ── Delete conversation ─────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/chat/conversations/:id', {
    schema: {
      tags: ['AI'],
      summary: 'Delete a conversation and all its messages',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    // Verify ownership before deleting
    const [conv] = await executeSelect<ConversationRow>(
      'SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?',
      [request.params.id, request.user.id],
    );
    if (!conv) return reply.status(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });

    await executeWrite(
      'DELETE FROM chat_conversations WHERE id = ? AND user_id = ?',
      [request.params.id, request.user.id],
    );
    return reply.status(200).send({ message: 'Conversation deleted' });
  });
}
