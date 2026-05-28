/**
 * AI Chat Route — Memory-Augmented Chat Endpoint
 *
 * POST /ai/chat/message
 *
 * This is an ADDITIVE route. It does not modify the existing
 * /chat/conversations endpoints or the MCP SSE interface.
 *
 * Flow:
 *   1. Authenticate caller
 *   2. Validate request body
 *   3. Optionally create/resolve conversation
 *   4. Save user message to chat_messages (same table as existing chat)
 *   5. Run AI Memory pipeline (normalise → Redis → Qdrant)
 *   6. If cache HIT  → return cached/learned response immediately
 *   7. If cache MISS → call chatWithTools() (existing OpenAI + MCP pipeline)
 *   8. Save AI response to chat_messages
 *   9. Queue async learning job (BullMQ)
 *  10. Record analytics (non-blocking)
 *  11. Return response with cache metadata
 *
 * GET /ai/chat/stats
 *   Returns in-memory cache performance counters (no auth required in dev).
 */

import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { authenticateRequest } from '../../middleware/auth.js';
import { checkAiRateLimit } from '../../middleware/ai-rate-limit.js';
import { executeSelect, executeWrite } from '../../database/client.js';
import { env } from '../../config/env.js';
import { chatWithTools, isPlaceholderResponse } from '../../openai/converter.js';
import type { ToolCallTrace } from '../../openai/converter.js';
import { queryMemory, buildLearningPayload, formatValidatedResponse } from '../../ai/memory/index.js';
import { enqueueLearning } from '../../ai/workers/index.js';
import { recordCacheLog, recordChatHistory, getCacheStats } from '../../ai/analytics/index.js';
import { classifyQuery } from '../../ai/security/query-classifier.js';
import { recordSecurityEvent } from '../../ai/security/audit.js';
import { CANNED_REFUSAL, scrubZeroResultLeak } from '../../ai/security/refusal.js';
import {
  getRiskState,
  recordRiskEvent,
  type RiskLevel,
} from '../../ai/security/risk-engine.js';
import { guardResponse } from '../../ai/security/response-guard.js';
import { isCacheable } from '../../ai/security/cache-safety.js';
import { redactToolCallsTrace } from '../../ai/security/trace-redactor.js';
import {
  getConversationContext,
  appendToContextCache,
  isContextualMessage,
  isLiveAnalyticsQuery,
} from '../../ai/conversation/context-manager.js';
import {
  getConversationState,
  saveConversationState,
  deriveStateUpdates,
} from '../../ai/conversation/state-engine.js';
import {
  getRecentToolResults,
  appendToolResults,
} from '../../ai/conversation/tool-results.js';
import { logger } from '../../utils/logger.js';
import type { Role } from '../../types/index.js';

// ─── Request / Response types ─────────────────────────────────────────────────

interface AiChatBody {
  message: string;
  conversationId?: string;
  systemPrompt?: string;
}

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
}

// ─── Route registration ────────────────────────────────────────────────────────

export async function aiChatRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /ai/chat/message ─────────────────────────────────────────────────

  fastify.post<{ Body: AiChatBody }>('/ai/chat/message', {
    schema: {
      tags: ['AI'],
      summary: 'Memory-augmented AI chat message',
      description:
        'Sends a message through the AI Memory pipeline. ' +
        'Cached responses skip OpenAI entirely. ' +
        'New responses are learned asynchronously for future reuse.',
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            minLength: 1,
            maxLength: 4096,
            description: 'The user question or command',
          },
          conversationId: {
            type: 'string',
            description: 'Existing conversation UUID. Omit to start a new conversation.',
          },
          systemPrompt: {
            type: 'string',
            maxLength: 8192,
            description: 'Optional custom system prompt override',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reply: { type: 'string' },
            conversationId: { type: 'string' },
            messageId: { type: 'string' },
            cached: { type: 'boolean' },
            cacheSource: { type: 'string', enum: ['redis', 'qdrant', 'openai'] },
            confidence: { type: 'number' },
            responseType: { type: 'string', enum: ['direct', 'validated', 'miss'] },
            responseMs: { type: 'number' },
            toolCallsExecuted: { type: 'number' },
            toolCallsTrace: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  args: { type: 'object', additionalProperties: true },
                  sql: { type: 'string' },
                  params: { type: 'array', items: {} },
                },
              },
            },
            modelTier: { type: 'string', enum: ['simple', 'reasoning', 'strict'] },
            modelUsed: { type: 'string' },
            grounded: { type: 'boolean' },
            ungroundedFacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest, checkAiRateLimit],
  }, async (request, reply) => {
    const startMs = Date.now();
    const { message, conversationId: inputConversationId, systemPrompt } = request.body;
    const userId = request.user.id;
    const callerRole = request.user.role as Role;

    // ── 0. Security gate (Phase 1 + 2) ───────────────────────────────────────
    // Layered:
    //   (a) Lockout check — if user is CRITICAL-locked, refuse immediately.
    //   (b) Classify the prompt (enumeration / schema / tool / sensitive).
    //   (c) Read current session risk level.
    //   (d) Decide effective action based on classification + risk level:
    //         LOW      → use classifier verdict as-is
    //         MEDIUM   → sensitive escalates to refusal
    //         HIGH     → every prompt refused; no tools, no model
    //         CRITICAL → HIGH behaviour + already locked out
    //   (e) If refusing, record points to the risk engine (which may
    //       transition the user to the next level and trigger lockout).

    const inputConvId = inputConversationId ?? null;

    const sendCannedRefusal = (
      eventType: 'refusal' | 'lockout_refusal',
      reasons: string[],
      category: string | null,
    ) => {
      recordSecurityEvent({
        userId,
        conversationId: inputConvId,
        eventType,
        classification: 'high_risk',
        category,
        reasons,
        promptExcerpt: message,
      }).catch(() => {});

      return reply.status(200).send({
        reply: CANNED_REFUSAL,
        conversationId: inputConvId,
        messageId: null,
        cached: false,
        cacheSource: 'openai',
        confidence: null,
        responseType: 'miss',
        responseMs: Date.now() - startMs,
        toolCallsExecuted: 0,
        toolCallsTrace: [],
        refused: true,
      });
    };

    const preRisk = await getRiskState(userId).catch(() => ({
      score: 0,
      level: 'LOW' as RiskLevel,
      lockedOut: false,
    }));

    // (a) Lockout — short-circuit before we even touch the classifier.
    if (preRisk.lockedOut) {
      logger.warn(
        { userId, score: preRisk.score },
        'AI security: refusing request — session is locked out',
      );
      return sendCannedRefusal('lockout_refusal', ['session locked out'], 'locked');
    }

    // (b) Classify.
    const classification = classifyQuery(message);

    // (c) Decide effective action.
    let effectiveAction: 'refuse' | 'allow' = 'allow';
    let refuseReasons: string[] = classification.reasons;
    let refuseCategory: string | null = classification.category ?? null;

    if (classification.classification === 'high_risk') {
      effectiveAction = 'refuse';
    } else if (
      classification.classification === 'sensitive' &&
      (preRisk.level === 'MEDIUM' || preRisk.level === 'HIGH' || preRisk.level === 'CRITICAL')
    ) {
      // MEDIUM escalation — once a session has shown probing, sensitive
      // queries no longer get the benefit of the doubt.
      effectiveAction = 'refuse';
      refuseReasons = [...refuseReasons, `escalated by session risk level ${preRisk.level}`];
    } else if (preRisk.level === 'HIGH' || preRisk.level === 'CRITICAL') {
      // HIGH+ — every prompt is refused regardless of classification.
      effectiveAction = 'refuse';
      refuseReasons = ['session risk is HIGH — all requests blocked'];
      refuseCategory = 'session_risk_high';
    }

    if (effectiveAction === 'refuse') {
      // (d) Score the event and (e) maybe trigger lockout / alert.
      const source =
        classification.classification === 'sensitive'
          ? 'sensitive'
          : 'refusal';

      const riskUpdate = await recordRiskEvent(userId, source).catch(() => null);

      // Audit the level transition itself (admins want to see it).
      if (riskUpdate?.transitioned) {
        recordSecurityEvent({
          userId,
          conversationId: inputConvId,
          eventType: 'risk_change',
          classification: classification.classification,
          category: refuseCategory,
          reasons: [
            `level: ${riskUpdate.before.level} → ${riskUpdate.after.level}`,
            `score: ${riskUpdate.before.score} → ${riskUpdate.after.score}`,
          ],
          promptExcerpt: message,
        }).catch(() => {});

        logger.warn(
          {
            event: 'ai.security.risk_change',
            userId,
            from: riskUpdate.before.level,
            to: riskUpdate.after.level,
            score: riskUpdate.after.score,
          },
          'AI security: session risk level changed',
        );
      }

      // CRITICAL transition → record lockout event and emit admin alert.
      if (
        riskUpdate &&
        riskUpdate.after.level === 'CRITICAL' &&
        riskUpdate.before.level !== 'CRITICAL'
      ) {
        recordSecurityEvent({
          userId,
          conversationId: inputConvId,
          eventType: 'lockout',
          classification: 'high_risk',
          category: 'session_critical',
          reasons: [
            `session score reached ${riskUpdate.after.score} (CRITICAL)`,
            '10-minute lockout applied',
          ],
          promptExcerpt: message,
        }).catch(() => {});

        // Structured alert log — alert engine can subscribe to `ai.security.alert`.
        logger.error(
          {
            event: 'ai.security.alert',
            severity: 'critical',
            userId,
            score: riskUpdate.after.score,
            lastPrompt: message.slice(0, 200),
          },
          'AI security ALERT: user session reached CRITICAL — locked out',
        );
      }

      logger.warn(
        {
          userId,
          category: refuseCategory,
          riskLevel: riskUpdate?.after.level ?? preRisk.level,
          riskScore: riskUpdate?.after.score ?? preRisk.score,
        },
        'AI security: refused prompt',
      );

      return sendCannedRefusal('refusal', refuseReasons, refuseCategory);
    }

    // (b/c continued) 'safe' or 'sensitive' below the escalation bar — log
    // the classification for visibility, then proceed normally.
    recordSecurityEvent({
      userId,
      conversationId: inputConvId,
      eventType: 'classification',
      classification: classification.classification,
      category: classification.category ?? null,
      reasons: classification.reasons,
      promptExcerpt: message,
    }).catch(() => {});

    if (classification.classification === 'sensitive') {
      // Audited but allowed at LOW — still scores points so a flurry of
      // bulk-export queries pushes the user toward MEDIUM.
      recordRiskEvent(userId, 'sensitive').catch(() => null);
    }

    // ── 1. Resolve or create conversation ────────────────────────────────────
    let conversationId = inputConversationId ?? null;

    if (conversationId) {
      // Verify the conversation belongs to this user
      const [conv] = await executeSelect<ConversationRow>(
        'SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?',
        [conversationId, userId],
      );
      if (!conv) {
        return reply.status(404).send({ error: 'Conversation not found', code: 'NOT_FOUND' });
      }
    } else {
      // Auto-create a new conversation with the message as the title
      conversationId = uuidv4();
      const title = message.slice(0, 100);
      await executeWrite(
        'INSERT INTO chat_conversations (id, user_id, title) VALUES (?, ?, ?)',
        [conversationId, userId, title],
      );
    }

    // ── 1a-3. Load context, state, recent tool results, save user message,
    //         and run memory lookup — all in parallel.
    // These operations are independent — running them concurrently shaves
    // 50-200ms off the response time vs. a sequential chain.
    const userMessageId = uuidv4();
    const [
      conversationContext,
      conversationState,
      recentToolResults,
      ,
      memoryResultPre,
    ] = await Promise.all([
      getConversationContext(conversationId),
      getConversationState(conversationId),
      getRecentToolResults(conversationId),
      executeWrite(
        'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
        [userMessageId, conversationId, 'user', message],
      ),
      queryMemory(message).catch((err) => {
        logger.warn({ err }, 'queryMemory failed — treating as cache miss');
        return null;
      }),
    ]);

    // Cache-bypass policy. Skip the semantic prompt-hash cache when:
    //   (a) the message references prior turns ("they", "it", "why?") AND
    //       there IS prior context to resolve against, OR
    //   (b) the message asks for LIVE analytics ("current success rate", "TPS
    //       now", "today's failed payouts"). Cached analytics go stale the
    //       moment the DB ticks forward — see screenshot bug where the first
    //       answer used cached counts and "recheck" returned fresher counts.
    const liveAnalytics = isLiveAnalyticsQuery(message);
    const contextual = conversationContext.length > 0 && isContextualMessage(message);
    const skipSemanticCache = contextual || liveAnalytics;

    if (liveAnalytics) {
      logger.info(
        { userId, conversationId, message: message.slice(0, 120) },
        'AI chat: live-analytics query — forcing MCP-first (semantic cache bypassed)',
      );
    }

    const memoryResult = skipSemanticCache || !memoryResultPre
      ? {
          hit: false as const,
          source: 'none' as const,
          responseType: 'miss' as const,
          normalizedPrompt: message,
          promptHash: '',
          intentCategory: 'general_inquiry',
          lookupMs: 0,
        }
      : memoryResultPre;

    let reply_text: string;
    let toolCallsExecuted = 0;
    let toolCallsTrace: ToolCallTrace[] = [];
    let cacheSource: 'redis' | 'qdrant' | 'openai' = 'openai';
    let modelTier: 'simple' | 'reasoning' | 'strict' | undefined;
    let modelUsed: string | undefined;
    let grounded: boolean | undefined;
    let ungroundedFacts: Array<{ kind: string; value: string }> = [];

    const cachedResponse = memoryResult.hit && memoryResult.response
      ? (memoryResult.responseType === 'validated'
          ? formatValidatedResponse(memoryResult.response, memoryResult.confidence ?? 0)
          : memoryResult.response)
      : null;
    const cacheHitValid = cachedResponse !== null && !isPlaceholderResponse(cachedResponse);

    if (cacheHitValid && cachedResponse) {
      // ── Cache HIT ──────────────────────────────────────────────────────────
      cacheSource = memoryResult.source as 'redis' | 'qdrant';
      reply_text = cachedResponse;

      logger.info(
        {
          userId,
          source: cacheSource,
          confidence: memoryResult.confidence,
          responseType: memoryResult.responseType,
          ms: Date.now() - startMs,
        },
        'AI chat: cache HIT — skipping OpenAI',
      );
    } else {
      // ── Cache MISS — call OpenAI + MCP tools ───────────────────────────────
      logger.info({ userId, intent: memoryResult.intentCategory }, 'AI chat: cache MISS — calling OpenAI');

      if (!env.OPENAI_API_KEY) {
        return reply.status(503).send({
          error: 'AI chat is not available: OPENAI_API_KEY is not configured on the server.',
          code: 'OPENAI_NOT_CONFIGURED',
        });
      }

      const chatResult = await chatWithTools({
        userMessage: message,
        systemPrompt,
        conversationHistory: conversationContext,
        conversationState,
        recentToolResults,
        callerId: userId,
        callerRole,
        callerName: request.user.name,
      });

      reply_text = chatResult.reply;
      toolCallsExecuted = chatResult.toolCallsExecuted;
      toolCallsTrace = chatResult.toolCallsTrace;
      cacheSource = 'openai';

      // ── Zero-result protection (Section 3) ───────────────────────────────
      // If every tool returned empty but the model still offered to fetch
      // "top X" or "similar Y", replace the reply with a flat empty-result
      // message. Each tool-role message in `chatResult.messages` holds the
      // JSON payload that was fed back to the model — that's our source of
      // truth for whether any data actually came back.
      const toolResultsRaw = chatResult.messages
        .filter((m): m is typeof m & { role: 'tool'; content: string } =>
          m.role === 'tool' && typeof m.content === 'string',
        )
        .map((m) => m.content);

      const scrub = scrubZeroResultLeak({
        reply: reply_text,
        toolCallsTrace,
        toolResultsRaw,
      });
      if (scrub.scrubbed) {
        reply_text = scrub.reply;
        recordSecurityEvent({
          userId,
          conversationId,
          eventType: 'zero_result_block',
          classification: classification.classification,
          category: classification.category ?? null,
          reasons: ['model offered alternatives after zero-result tool calls'],
          promptExcerpt: message,
        }).catch(() => {});
        // Scrubbed leaks accumulate risk too — three of these in a window
        // pushes the user toward MEDIUM the same way refusals do.
        recordRiskEvent(userId, 'zero_result_block').catch(() => null);
        logger.warn({ userId, conversationId }, 'AI security: scrubbed zero-result leak');
      }
      modelTier = chatResult.tier;
      modelUsed = chatResult.modelUsed;
      grounded = chatResult.validation?.grounded;
      ungroundedFacts = (chatResult.validation?.unsupported ?? []).map((u) => ({
        kind: u.kind,
        value: u.value,
      }));

      // ── MCP trust layer / response validation (Section 7 + 9) ─────────────
      // If the model returned currency / IDs that don't appear in the tool
      // results, replace the reply with the safe fallback. The original
      // ungrounded text is preserved in the structured warning log.
      const guard = guardResponse({
        reply: reply_text,
        validation: chatResult.validation,
      });
      if (guard.blocked) {
        reply_text = guard.reply;
        grounded = false;
        recordSecurityEvent({
          userId,
          conversationId,
          eventType: 'zero_result_block', // re-using the closest existing kind
          classification: classification.classification,
          category: 'ungrounded_reply',
          reasons: [guard.reason ?? 'response failed grounding check'],
          promptExcerpt: message,
        }).catch(() => {});
      }

      // ── Persist tool-result sidecar + advance conversation state ──────────
      // Fire-and-forget — non-blocking. Both writes are Redis-only with TTL.
      if (chatResult.newToolResults.length > 0) {
        appendToolResults(conversationId, chatResult.newToolResults).catch(() => {});
      }
      const nextState = deriveStateUpdates(conversationState, message, toolCallsTrace);
      saveConversationState(conversationId, nextState).catch(() => {});

      // Structured query audit log — used for customer behavior analysis
      if (toolCallsTrace.length > 0) {
        logger.info({
          event: 'ai.query_log',
          userId,
          conversationId,
          tier: chatResult.tier,
          model: chatResult.modelUsed,
          tools: toolCallsTrace.map(t => ({
            tool: t.name,
            args: t.args,
          })),
          toolCount: toolCallsExecuted,
          grounded: chatResult.validation?.grounded ?? null,
          ungroundedCount: chatResult.validation?.unsupported.length ?? 0,
          responseMs: Date.now() - startMs,
        }, 'AI tool queries executed');
      }

      // ── Queue async learning (non-blocking) ────────────────────────────────
      // Skip learning for empty-result responses so "No records found" answers
      // never pollute the cache and replay on future queries that have real data.
      const isEmptyResult =
        reply_text.toLowerCase().includes('no records found') ||
        reply_text.toLowerCase().includes('no data found') ||
        reply_text.toLowerCase().includes('no results found') ||
        reply_text.toLowerCase().includes('no matching records') ||
        reply_text.toLowerCase().includes('0 records');

      // Cache safety (Section 16): some replies — those naming specific
      // payouts, merchants, accounts — must NEVER be semantic-cached because
      // a fuzzy-similar future prompt would replay this user's private data.
      const cacheability = isCacheable(message, reply_text);

      if (
        !isEmptyResult &&
        !isPlaceholderResponse(reply_text) &&
        cacheability.cacheable
      ) {
        const learningPayload = buildLearningPayload({
          originalPrompt: message,
          response: reply_text,
          userId,
          toolCallsCount: toolCallsExecuted,
          memoryResult,
        });

        enqueueLearning(learningPayload).catch((e: unknown) =>
          logger.warn({ err: e }, 'enqueueLearning failed'),
        );
      } else if (!cacheability.cacheable) {
        logger.info(
          {
            userId,
            intent: memoryResult.intentCategory,
            source: cacheability.source,
            reason: cacheability.reason,
          },
          'AI chat: skipping learning enqueue — response not safe to cache',
        );
      } else {
        logger.info(
          { userId, intent: memoryResult.intentCategory },
          'AI chat: skipping learning enqueue — response was empty result',
        );
      }
    }

    const responseMs = Date.now() - startMs;

    // ── 3a. Update Redis context cache (non-blocking) ─────────────────────────
    // Appends the new user+assistant exchange so the next request in this
    // conversation gets an L1 cache hit and skips the MySQL round-trip.
    appendToContextCache(conversationId, message, reply_text).catch(() => {});

    // ── 4-5. Persist assistant message + bump conversation timestamp in parallel ─
    const assistantMessageId = uuidv4();
    const persistPromise = Promise.all([
      executeWrite(
        'INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)',
        [assistantMessageId, conversationId, 'assistant', reply_text],
      ),
      executeWrite(
        'UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId],
      ),
    ]);

    // ── 6. Record analytics (fire-and-forget) ─────────────────────────────────
    const sqlQueries = toolCallsTrace
      .filter((t) => t.sql)
      .map((t) => ({ name: t.name, sql: t.sql, params: t.params }));

    recordCacheLog({
      promptHash: memoryResult.promptHash,
      cacheSource,
      hit: cacheHitValid,
      confidence: memoryResult.confidence,
      responseMs,
    }).catch(() => {});

    recordChatHistory({
      userId,
      conversationId,
      originalPrompt: message,
      normalizedPrompt: memoryResult.normalizedPrompt,
      promptHash: memoryResult.promptHash,
      response: reply_text,
      cacheHit: cacheHitValid,
      cacheSource,
      confidenceScore: memoryResult.confidence ?? null,
      responseMs,
      toolCallsCount: toolCallsExecuted,
      sqlQueries,
    }).catch(() => {});

    // Wait for the assistant-message write so the response is consistent.
    await persistPromise;

    // Frontend safety (Section 17 + Phase 4 role visibility): every caller
    // gets exactly the level of trace detail their visibility tier permits.
    // - admin    → real tool name + args + sql + params
    // - service  → real tool name + args (no SQL)
    // - analyst  → generic category label only ("payout_query"), no args
    // - readonly → same as analyst
    const safeTrace = redactToolCallsTrace(toolCallsTrace, callerRole);

    return reply.status(200).send({
      reply: reply_text,
      conversationId,
      messageId: assistantMessageId,
      cached: cacheHitValid,
      cacheSource,
      confidence: memoryResult.confidence,
      responseType: memoryResult.responseType,
      responseMs,
      toolCallsExecuted,
      toolCallsTrace: safeTrace,
      modelTier,
      modelUsed,
      grounded,
      ungroundedFacts,
    });
  });

  // ── GET /ai/chat/stats ────────────────────────────────────────────────────

  fastify.get('/ai/chat/stats', {
    schema: {
      tags: ['AI'],
      summary: 'AI Memory cache performance statistics',
      description: 'Returns in-memory counters for cache hits, miss rates, and average latency.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async () => {
    return getCacheStats();
  });

  // ── GET /ai/memory/knowledge ──────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>('/ai/memory/knowledge', {
    schema: {
      tags: ['AI'],
      summary: 'List learned knowledge entries',
      querystring: {
        type: 'object',
        properties: { limit: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);
    const rows = await executeSelect(
      `SELECT id, original_prompt, normalized_prompt, intent_category, hit_count, confidence, created_at, updated_at
       FROM ai_knowledge
       ORDER BY hit_count DESC
       LIMIT ${limit}`,
      [],
    );
    return reply.status(200).send({ rows });
  });

  // ── GET /ai/memory/history ────────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>('/ai/memory/history', {
    schema: {
      tags: ['AI'],
      summary: 'List AI chat history entries',
      querystring: {
        type: 'object',
        properties: { limit: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '100', 10) || 100, 500);
    const rows = await executeSelect(
      `SELECT id, user_id, original_prompt, response, cache_hit, cache_source, confidence_score, response_ms, tool_calls_count, sql_queries, created_at
       FROM ai_chat_history
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      [],
    );
    return reply.status(200).send({ rows });
  });

  // ── GET /ai/memory/cache-logs ─────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>('/ai/memory/cache-logs', {
    schema: {
      tags: ['AI'],
      summary: 'List AI cache log entries',
      querystring: {
        type: 'object',
        properties: { limit: { type: 'string' } },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '200', 10) || 200, 1000);
    const rows = await executeSelect(
      `SELECT id, prompt_hash, cache_source, hit, confidence, response_ms, created_at
       FROM ai_cache_logs
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      [],
    );
    return reply.status(200).send({ rows });
  });

  // ── POST /ai/chat/feedback ────────────────────────────────────────────────

  fastify.post<{
    Body: { messageId: string; rating: number; feedbackType: 'positive' | 'negative' | 'neutral'; comment?: string };
  }>('/ai/chat/feedback', {
    schema: {
      tags: ['AI'],
      summary: 'Submit feedback on an AI response',
      body: {
        type: 'object',
        required: ['messageId', 'rating', 'feedbackType'],
        properties: {
          messageId: { type: 'string' },
          rating: { type: 'number', minimum: 1, maximum: 5 },
          feedbackType: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          comment: { type: 'string', maxLength: 1000 },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { messageId, rating, feedbackType, comment } = request.body;
    const userId = request.user.id;

    await executeWrite(
      `INSERT INTO ai_feedback (id, chat_history_id, user_id, rating, feedback_type, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), messageId, userId, rating, feedbackType, comment ?? null],
    );

    return reply.status(201).send({ success: true });
  });
}
