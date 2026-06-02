/**
 * AI Background Job Routes — Feature 1, 5, 9
 *
 * POST /ai/chat/queue          Queue a message for background AI processing.
 *                              Returns immediately with a jobId so the client
 *                              can navigate away safely.
 *
 * GET  /ai/chat/jobs/:jobId    Poll job status / retrieve completed result.
 *
 * POST /ai/chat/jobs/:jobId/cancel   Cancel a pending or processing job.
 *
 * POST /chat/messages/:id/edit       Edit a sent message and re-queue AI (Feature 6).
 */

import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { authenticateRequest } from '../../middleware/auth.js';
import { checkAiRateLimit } from '../../middleware/ai-rate-limit.js';
import { executeSelect, executeWrite } from '../../database/client.js';
import { aiProcessingQueue, type AiProcessingJobData } from '../../queue/client.js';
import { classifyQuery } from '../../ai/security/query-classifier.js';
import { getRiskState, recordRiskEvent, type RiskLevel } from '../../ai/security/risk-engine.js';
import { recordSecurityEvent } from '../../ai/security/audit.js';
import { CANNED_REFUSAL, DOMAIN_REFUSAL } from '../../ai/security/refusal.js';
import { logger } from '../../utils/logger.js';
import type { Role } from '../../types/index.js';

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
}

interface AiJobRow {
  id: string;
  conversation_id: string;
  user_id: string;
  message_id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  result_message_id: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

export async function aiJobRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /ai/chat/queue ───────────────────────────────────────────────────
  // Saves the user message immediately, creates a BullMQ job, and returns
  // without waiting for AI to finish. The browser can safely navigate away —
  // the worker will complete processing and emit ai:job_complete via Socket.io.

  fastify.post<{
    Body: { message: string; conversationId?: string; systemPrompt?: string };
  }>('/ai/chat/queue', {
    schema: {
      tags: ['AI'],
      summary: 'Queue a message for background AI processing',
      description:
        'Returns immediately with a jobId. The AI processes in the background. ' +
        'Listen for `ai:job_complete` on Socket.io or poll GET /ai/chat/jobs/:jobId.',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 4096 },
          conversationId: { type: 'string' },
          systemPrompt: { type: 'string', maxLength: 8192 },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, checkAiRateLimit],
  }, async (request, reply) => {
    const { message, conversationId: inputConversationId, systemPrompt } = request.body;
    const userId = request.user.id;
    const callerRole = request.user.role as Role;
    const inputConvId = inputConversationId ?? null;

    // ── Security gate (same as ai-chat.ts) ───────────────────────────────────
    const preRisk = await getRiskState(userId).catch(() => ({
      score: 0,
      level: 'LOW' as RiskLevel,
      lockedOut: false,
    }));

    if (preRisk.lockedOut) {
      return reply.status(200).send({
        reply: CANNED_REFUSAL,
        conversationId: inputConvId,
        jobId: null,
        status: 'CANCELLED',
        refused: true,
      });
    }

    const classification = classifyQuery(message);
    let effectiveAction: 'refuse' | 'allow' = 'allow';

    if (classification.classification === 'high_risk') {
      effectiveAction = 'refuse';
    } else if (
      classification.classification === 'sensitive' &&
      (preRisk.level === 'MEDIUM' || preRisk.level === 'HIGH' || preRisk.level === 'CRITICAL')
    ) {
      effectiveAction = 'refuse';
    } else if (preRisk.level === 'HIGH' || preRisk.level === 'CRITICAL') {
      effectiveAction = 'refuse';
    }

    if (effectiveAction === 'refuse') {
      await recordRiskEvent(userId, 'refusal').catch(() => null);
      recordSecurityEvent({
        userId,
        conversationId: inputConvId,
        eventType: 'refusal',
        classification: classification.classification,
        category: classification.category ?? null,
        reasons: classification.reasons,
        promptExcerpt: message,
      }).catch(() => {});

      const refusalMessage =
        classification.category === 'out_of_domain' ? DOMAIN_REFUSAL : CANNED_REFUSAL;

      return reply.status(200).send({
        reply: refusalMessage,
        conversationId: inputConvId,
        jobId: null,
        status: 'CANCELLED',
        refused: true,
      });
    }

    // ── Resolve or create conversation ────────────────────────────────────────
    let conversationId = inputConversationId ?? null;

    if (conversationId) {
      const [conv] = await executeSelect<ConversationRow>(
        'SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?',
        [conversationId, userId],
      );
      if (!conv) {
        return reply.status(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });
      }
    } else {
      conversationId = uuidv4();
      const title = message.slice(0, 100);
      await executeWrite(
        'INSERT INTO chat_conversations (id, user_id, title) VALUES (?, ?, ?)',
        [conversationId, userId, title],
      );
    }

    // ── Save user message immediately ─────────────────────────────────────────
    const userMessageId = uuidv4();
    await executeWrite(
      'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
      [userMessageId, conversationId, 'user', message],
    );

    // ── Create job record in DB ───────────────────────────────────────────────
    const jobId = uuidv4();
    await executeWrite(
      `INSERT INTO ai_jobs (id, conversation_id, user_id, message_id, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [jobId, conversationId, userId, userMessageId],
    );

    // ── Enqueue BullMQ job ────────────────────────────────────────────────────
    const jobData: AiProcessingJobData = {
      jobId,
      conversationId,
      userId,
      callerRole,
      callerName: request.user.name,
      message,
      userMessageId,
      systemPrompt,
    };

    try {
      await aiProcessingQueue.add('process', jobData, {
        jobId,            // BullMQ job ID matches our DB record ID
        priority: 1,
      });
    } catch (queueErr) {
      logger.error({ err: queueErr, jobId }, 'Failed to enqueue AI job — Redis/BullMQ unavailable');
      await executeWrite(
        "UPDATE ai_jobs SET status = 'FAILED', error_message = 'Queue unavailable' WHERE id = ?",
        [jobId],
      ).catch(() => {});
      return reply.status(503).send({
        error: 'Background processing queue is currently unavailable. Please try again.',
        code: 'QUEUE_UNAVAILABLE',
      });
    }

    logger.info(
      { jobId, conversationId, userId },
      'AI job queued for background processing',
    );

    return reply.status(202).send({
      jobId,
      conversationId,
      userMessageId,
      status: 'PENDING',
    });
  });

  // ── GET /ai/chat/jobs/:jobId ──────────────────────────────────────────────
  // Poll endpoint — returns current status and, when completed, the full
  // response message content.

  fastify.get<{ Params: { jobId: string } }>('/ai/chat/jobs/:jobId', {
    schema: {
      tags: ['AI'],
      summary: 'Get status of a background AI job',
      params: {
        type: 'object',
        required: ['jobId'],
        properties: { jobId: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { jobId } = request.params;
    const userId = request.user.id;

    const [job] = await executeSelect<AiJobRow>(
      'SELECT * FROM ai_jobs WHERE id = ? AND user_id = ?',
      [jobId, userId],
    );

    if (!job) {
      return reply.status(404).send({ error: 'Job not found', code: 'NOT_FOUND' });
    }

    let resultMessage: MessageRow | undefined;
    if (job.status === 'COMPLETED' && job.result_message_id) {
      const [msg] = await executeSelect<MessageRow>(
        'SELECT id, role, content, created_at FROM chat_messages WHERE id = ?',
        [job.result_message_id],
      );
      resultMessage = msg;
    }

    return reply.status(200).send({
      jobId: job.id,
      conversationId: job.conversation_id,
      status: job.status,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
      error: job.error_message,
      result: resultMessage
        ? { messageId: resultMessage.id, content: resultMessage.content, createdAt: resultMessage.created_at }
        : null,
    });
  });

  // ── POST /ai/chat/jobs/:jobId/cancel ─────────────────────────────────────
  // Cancels a PENDING or PROCESSING job. Cannot cancel COMPLETED jobs.

  fastify.post<{ Params: { jobId: string } }>('/ai/chat/jobs/:jobId/cancel', {
    schema: {
      tags: ['AI'],
      summary: 'Cancel a background AI job',
      params: {
        type: 'object',
        required: ['jobId'],
        properties: { jobId: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { jobId } = request.params;
    const userId = request.user.id;

    const [job] = await executeSelect<AiJobRow>(
      'SELECT id, status, conversation_id FROM ai_jobs WHERE id = ? AND user_id = ?',
      [jobId, userId],
    );

    if (!job) {
      return reply.status(404).send({ error: 'Job not found', code: 'NOT_FOUND' });
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return reply.status(409).send({
        error: `Cannot cancel a job with status: ${job.status}`,
        code: 'ALREADY_FINAL',
      });
    }

    // Remove from BullMQ queue (if still PENDING) — ignore if already gone
    try {
      const bullJob = await aiProcessingQueue.getJob(jobId);
      if (bullJob) await bullJob.remove();
    } catch {
      // Job may already be processing — mark DB row and the worker will check
    }

    await executeWrite(
      "UPDATE ai_jobs SET status = 'CANCELLED', completed_at = NOW() WHERE id = ?",
      [jobId],
    );

    logger.info({ jobId, userId }, 'AI job cancelled by user');
    return reply.status(200).send({ jobId, status: 'CANCELLED' });
  });

  // ── POST /chat/messages/:id/edit  — Feature 6: Edit & Resend ─────────────
  // Saves the original message as a version, updates the content, clears
  // all subsequent messages, and queues a new AI response.

  fastify.post<{
    Params: { id: string };
    Body: { content: string };
  }>('/chat/messages/:id/edit', {
    schema: {
      tags: ['AI'],
      summary: 'Edit a sent message and re-queue AI response',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', minLength: 1, maxLength: 4096 } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { id: messageId } = request.params;
    const { content: newContent } = request.body;
    const userId = request.user.id;

    // Verify ownership via conversation
    const [msgRow] = await executeSelect<{
      id: string; conversation_id: string; role: string; content: string; created_at: Date;
    }>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND c.user_id = ? AND m.role = 'user'`,
      [messageId, userId],
    );

    if (!msgRow) {
      return reply.status(404).send({ error: 'Message not found or not editable', code: 'NOT_FOUND' });
    }

    const { conversation_id: conversationId } = msgRow;

    // Get current version count for this message
    const [versionRow] = await executeSelect<{ maxVersion: number | null }>(
      'SELECT MAX(version) as maxVersion FROM message_versions WHERE message_id = ?',
      [messageId],
    );
    const nextVersion = (versionRow?.maxVersion ?? 0) + 1;

    // Save original content as version
    await executeWrite(
      'INSERT INTO message_versions (id, message_id, version, role, content) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), messageId, nextVersion, 'user', msgRow.content],
    );

    // Update message with new content
    await executeWrite(
      'UPDATE chat_messages SET content = ? WHERE id = ?',
      [newContent, messageId],
    );

    // Delete all messages after this one (removes the old AI response)
    await executeWrite(
      `DELETE FROM chat_messages
        WHERE conversation_id = ? AND created_at > ?`,
      [conversationId, msgRow.created_at],
    );

    // Queue fresh AI response
    const jobId = uuidv4();
    await executeWrite(
      `INSERT INTO ai_jobs (id, conversation_id, user_id, message_id, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [jobId, conversationId, userId, messageId],
    );

    const callerRole = request.user.role as Role;
    const jobData: AiProcessingJobData = {
      jobId,
      conversationId,
      userId,
      callerRole,
      callerName: request.user.name,
      message: newContent,
      userMessageId: messageId,
    };

    await aiProcessingQueue.add('process', jobData, { jobId, priority: 1 });

    return reply.status(202).send({
      jobId,
      conversationId,
      messageId,
      status: 'PENDING',
    });
  });
}
