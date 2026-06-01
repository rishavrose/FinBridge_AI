/**
 * AI Processing Worker — Feature 1, 7, 9
 *
 * Processes queued AI chat jobs in the background. This worker runs the full
 * AI pipeline (context load → OpenAI + MCP tools → persist → learn) and then
 * emits ai:job_complete to the owning user's Socket.io room.
 *
 * Because the job runs inside BullMQ (not inside an HTTP handler), it
 * survives tab switches, page navigations, and short network outages.
 */

import { Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { executeSelect, executeWrite } from '../database/client.js';
import { chatWithTools } from '../openai/converter.js';
import {
  getConversationContext,
  appendToContextCache,
  isLiveAnalyticsQuery,
  isContextualMessage,
} from '../ai/conversation/context-manager.js';
import {
  getConversationState,
  saveConversationState,
  deriveStateUpdates,
} from '../ai/conversation/state-engine.js';
import { getRecentToolResults, appendToolResults } from '../ai/conversation/tool-results.js';
import { enqueueLearning } from '../ai/workers/index.js';
import { buildLearningPayload } from '../ai/memory/index.js';
import { recordCacheLog, recordChatHistory } from '../ai/analytics/index.js';
import { isPlaceholderResponse } from '../openai/converter.js';
import { isCacheable } from '../ai/security/cache-safety.js';
import { scrubZeroResultLeak } from '../ai/security/refusal.js';
import { guardResponse } from '../ai/security/response-guard.js';
import { recordSecurityEvent } from '../ai/security/audit.js';
import { recordRiskEvent } from '../ai/security/risk-engine.js';
import {
  emitAiProgressToUser,
  emitAiToolStartToUser,
  emitAiToolDoneToUser,
  emitJobComplete,
  emitJobFailed,
} from '../realtime/socket.js';
import type { AiProcessingJobData } from '../queue/client.js';
import type { Role } from '../types/index.js';
import { sanitizeErrorForUser } from '../utils/errors.js';

const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
};

let _worker: Worker | null = null;

export function startAiProcessingWorker(): void {
  if (_worker) return;

  _worker = new Worker<AiProcessingJobData>(
    'ai-processing',
    async (job) => {
      const {
        jobId,
        conversationId,
        userId,
        callerRole,
        callerName,
        message,
        systemPrompt,
      } = job.data;

      const startMs = Date.now();

      logger.info({ jobId, conversationId, userId }, 'AI processing job started');

      // Mark job as PROCESSING in DB
      await executeWrite(
        "UPDATE ai_jobs SET status = 'PROCESSING' WHERE id = ?",
        [jobId],
      ).catch(() => {});

      emitAiProgressToUser(userId, {
        conversationId,
        stage: 'start',
        message: 'Analyzing your query...',
      });

      try {
        // Check if job was cancelled while queued
        const [jobRow] = await executeSelect<{ status: string }>(
          'SELECT status FROM ai_jobs WHERE id = ?',
          [jobId],
        );
        if (jobRow?.status === 'CANCELLED') {
          logger.info({ jobId }, 'AI job was cancelled — skipping processing');
          return;
        }

        // Load context, state, recent tool results in parallel
        const [conversationContext, conversationState, recentToolResults] = await Promise.all([
          getConversationContext(conversationId),
          getConversationState(conversationId),
          getRecentToolResults(conversationId),
        ]);

        const liveAnalytics = isLiveAnalyticsQuery(message);
        const contextual = conversationContext.length > 0 && isContextualMessage(message);

        if (liveAnalytics || contextual) {
          logger.info(
            { userId, conversationId },
            'AI background job: forcing MCP-first (always live)',
          );
        }

        emitAiProgressToUser(userId, {
          conversationId,
          stage: 'cache_check',
          message: 'Fetching live data from systems...',
        });

        emitAiProgressToUser(userId, {
          conversationId,
          stage: 'generating',
          message: 'Running AI analysis on live systems...',
        });

        if (!env.OPENAI_API_KEY) {
          throw new Error('OPENAI_API_KEY not configured');
        }

        const chatResult = await chatWithTools({
          userMessage: message,
          systemPrompt,
          conversationHistory: conversationContext,
          conversationState,
          recentToolResults,
          callerId: userId,
          callerRole: callerRole as Role,
          callerName,
        });

        let replyText = chatResult.reply;
        const toolCallsTrace = chatResult.toolCallsTrace;
        const toolCallsExecuted = chatResult.toolCallsExecuted;

        // Emit tool activity events
        for (const trace of toolCallsTrace) {
          emitAiToolStartToUser(userId, conversationId, trace.name);
          emitAiToolDoneToUser(userId, conversationId, trace.name);
        }

        emitAiProgressToUser(userId, {
          conversationId,
          stage: 'validating',
          message: 'Verifying response accuracy...',
        });

        // Zero-result protection
        const toolResultsRaw = chatResult.messages
          .filter((m): m is typeof m & { role: 'tool'; content: string } =>
            m.role === 'tool' && typeof m.content === 'string')
          .map((m) => m.content);

        const scrub = scrubZeroResultLeak({ reply: replyText, toolCallsTrace, toolResultsRaw });
        if (scrub.scrubbed) {
          replyText = scrub.reply;
          recordSecurityEvent({
            userId,
            conversationId,
            eventType: 'zero_result_block',
            classification: 'safe',
            category: null,
            reasons: ['model offered alternatives after zero-result tool calls'],
            promptExcerpt: message,
          }).catch(() => {});
          recordRiskEvent(userId, 'zero_result_block').catch(() => null);
        }

        // Response guard
        const guard = guardResponse({ reply: replyText, validation: chatResult.validation });
        if (guard.blocked) {
          replyText = guard.reply;
        }

        // Persist tool sidecar + state
        if (chatResult.newToolResults.length > 0) {
          appendToolResults(conversationId, chatResult.newToolResults).catch(() => {});
        }
        const nextState = deriveStateUpdates(conversationState, message, toolCallsTrace);
        saveConversationState(conversationId, nextState).catch(() => {});

        // Update Redis context cache
        appendToContextCache(conversationId, message, replyText).catch(() => {});

        // Persist assistant message
        const assistantMessageId = uuidv4();
        await Promise.all([
          executeWrite(
            'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
            [assistantMessageId, conversationId, 'assistant', replyText],
          ),
          executeWrite(
            'UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?',
            [conversationId],
          ),
        ]);

        // Mark job COMPLETED in DB
        await executeWrite(
          `UPDATE ai_jobs
             SET status = 'COMPLETED', result_message_id = ?, completed_at = NOW()
           WHERE id = ?`,
          [assistantMessageId, jobId],
        );

        const responseMs = Date.now() - startMs;

        // Analytics (fire-and-forget)
        const sqlQueries = toolCallsTrace
          .filter((t) => t.sql)
          .map((t) => ({ name: t.name, sql: t.sql, params: t.params }));

        recordCacheLog({
          promptHash: '',
          cacheSource: 'openai',
          hit: false,
          confidence: undefined,
          responseMs,
        }).catch(() => {});

        recordChatHistory({
          userId,
          conversationId,
          originalPrompt: message,
          normalizedPrompt: message,
          promptHash: '',
          response: replyText,
          cacheHit: false,
          cacheSource: 'openai',
          confidenceScore: null,
          responseMs,
          toolCallsCount: toolCallsExecuted,
          sqlQueries,
        }).catch(() => {});

        // Learning (fire-and-forget)
        const isEmptyResult =
          replyText.toLowerCase().includes('no records found') ||
          replyText.toLowerCase().includes('no data found') ||
          replyText.toLowerCase().includes('no results found') ||
          replyText.toLowerCase().includes('0 records');

        const cacheability = isCacheable(message, replyText);
        if (!isEmptyResult && !isPlaceholderResponse(replyText) && cacheability.cacheable) {
          const learningPayload = buildLearningPayload({
            originalPrompt: message,
            response: replyText,
            userId,
            toolCallsCount: toolCallsExecuted,
            memoryResult: {
              hit: false,
              source: 'none',
              responseType: 'miss',
              normalizedPrompt: message,
              promptHash: '',
              intentCategory: 'general_inquiry',
              lookupMs: 0,
            },
          });
          enqueueLearning(learningPayload).catch(() => {});
        }

        // Emit completion to user's Socket.io room
        emitAiProgressToUser(userId, {
          conversationId,
          stage: 'complete',
          message: 'Response ready.',
        });

        emitJobComplete(userId, {
          jobId,
          conversationId,
          messageId: assistantMessageId,
          reply: replyText,
        });

        logger.info(
          { jobId, conversationId, userId, responseMs },
          'AI processing job completed',
        );
      } catch (err) {
        const rawErrMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, jobId, conversationId }, 'AI processing job failed');

        await executeWrite(
          "UPDATE ai_jobs SET status = 'FAILED', error_message = ?, completed_at = NOW() WHERE id = ?",
          [rawErrMsg.slice(0, 500), jobId],
        ).catch(() => {});

        emitJobFailed(userId, {
          jobId,
          conversationId,
          error: sanitizeErrorForUser(err),
        });

        throw err; // Let BullMQ record the failure
      }
    },
    {
      connection,
      concurrency: 3,   // process up to 3 AI jobs simultaneously
    },
  );

  _worker.on('error', (err) => logger.error({ err }, 'AI processing worker error'));

  logger.info('✅ AI processing worker started');
}

export async function closeAiProcessingWorker(): Promise<void> {
  await _worker?.close();
  _worker = null;
}
