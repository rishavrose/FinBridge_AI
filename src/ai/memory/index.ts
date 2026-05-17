/**
 * AI Memory Manager — Central Orchestrator
 *
 * This is the single entry-point for the AI Memory + Semantic Cache system.
 * Every user message passes through here before reaching OpenAI.
 *
 * Decision pipeline:
 *
 *  User prompt
 *    │
 *    ▼
 *  Normalize & Hash
 *    │
 *    ▼
 *  Redis Exact Cache ──HIT──► Return CachedResponse (< 5 ms)
 *    │
 *   MISS
 *    │
 *    ▼
 *  Generate Embedding
 *    │
 *    ▼
 *  Qdrant Similarity Search
 *    │
 *    ├─ score ≥ DIRECT_THRESHOLD (0.95)  ──► Return learned response directly
 *    ├─ score ≥ SIMILARITY_THRESHOLD (0.85) ► Return learned response + "similar" note
 *    └─ score < SIMILARITY_THRESHOLD ────► MISS (caller must invoke OpenAI)
 *
 * On an OpenAI response, `queueLearning()` must be called asynchronously so
 * the knowledge is persisted without blocking the HTTP response.
 */

import { v4 as uuidv4 } from 'uuid';
import { normalizePrompt, hashPrompt, detectIntent } from '../normalization/index.js';
import { generateEmbedding } from '../embeddings/index.js';
import { getCachedResponse, setCachedResponse, invalidateCachedResponse } from '../cache/index.js';
import { searchSimilarKnowledge, incrementVectorHitCount } from '../vector/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Empty-result guard ─────────────────────────────────────────────────────

/**
 * Returns true when the AI responded with a "no data" message.
 * These responses must never be served from cache because the underlying
 * data may exist on a subsequent query (e.g. after a date-filter fix).
 */
function isEmptyResultResponse(response: string): boolean {
  const lower = response.toLowerCase();
  return (
    lower.includes('no records found') ||
    lower.includes('no data found') ||
    lower.includes('no results found') ||
    lower.includes('no matching records') ||
    lower.includes('0 records')
  );
}

// ─── Date guard helpers ─────────────────────────────────────────────────────

function canonicalDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Extracts explicit dates like 2026-05-01 or 2026/5/1 from raw user text. */
function extractDatesFromRawPrompt(text: string): Set<string> {
  const matches = text.matchAll(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/g);
  const dates = new Set<string>();
  for (const m of matches) {
    dates.add(canonicalDate(m[1], m[2], m[3]));
  }
  return dates;
}

/**
 * Normalized prompts replace punctuation with spaces, so dates look like:
 * "2026 05 01". We recover that here for candidate validation.
 */
function extractDatesFromNormalizedPrompt(text: string): Set<string> {
  const matches = text.matchAll(/(?:^|\s)(\d{4})\s(\d{1,2})\s(\d{1,2})(?=\s|$)/g);
  const dates = new Set<string>();
  for (const m of matches) {
    dates.add(canonicalDate(m[1], m[2], m[3]));
  }
  return dates;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** What the memory system found (or didn't find) for this prompt. */
export interface MemoryQueryResult {
  /** Whether a usable response was found in the cache/memory */
  hit: boolean;
  /** Where the response came from */
  source: 'redis' | 'qdrant' | 'none';
  /** The response text (undefined on miss) */
  response?: string;
  /** Similarity score [0, 1]; 1.0 for exact Redis hits */
  confidence?: number;
  /**
   * How the response should be presented:
   *  - "direct"    : score ≥ 0.95 — serve as-is
   *  - "validated" : score 0.85–0.95 — prepend similarity note
   *  - "miss"      : score < 0.85 — call OpenAI
   */
  responseType: 'direct' | 'validated' | 'miss';
  /** ai_knowledge.id for hit-count bookkeeping */
  knowledgeId?: string;
  /** Qdrant point ID (may differ from knowledgeId) */
  vectorId?: string;
  /** Normalised prompt string */
  normalizedPrompt: string;
  /** SHA-256 hash of normalised prompt */
  promptHash: string;
  /** Detected intent category */
  intentCategory: string;
  /** Total time spent in memory lookup (ms) */
  lookupMs: number;
}

/** Data needed to persist new knowledge after an OpenAI call. */
export interface LearningPayload {
  /** UUID for the new ai_knowledge row; generate before calling chatWithTools */
  knowledgeId: string;
  originalPrompt: string;
  normalizedPrompt: string;
  promptHash: string;
  intentCategory: string;
  response: string;
  sqlResult?: unknown;
  userId: string;
  toolCallsCount: number;
}

// ─── Memory lookup ─────────────────────────────────────────────────────────────

/**
 * Looks up a user prompt in the AI memory system.
 *
 * The lookup is intentionally non-throwing: any internal error causes
 * the function to return a "miss" result so that the caller can always
 * fall through to OpenAI.
 */
export async function queryMemory(prompt: string): Promise<MemoryQueryResult> {
  const startMs = Date.now();
  const normalizedPrompt = normalizePrompt(prompt);
  const promptHash = hashPrompt(normalizedPrompt);
  const intentCategory = detectIntent(prompt);
  const requestedDates = extractDatesFromRawPrompt(prompt);

  const base = { normalizedPrompt, promptHash, intentCategory };

  if (!env.AI_MEMORY_ENABLED) {
    return { hit: false, source: 'none', responseType: 'miss', lookupMs: 0, ...base };
  }

  // ── 1. Redis exact cache ──────────────────────────────────────────────────
  try {
    const cached = await getCachedResponse(promptHash);
    if (cached) {
      // Date guard: if the query contains explicit dates, verify the cached
      // response actually mentions those dates. A mismatch means the entry was
      // poisoned (a different-date query's response was stored under this hash)
      // — evict it and fall through to vector search + OpenAI.
      // Empty-result guard: never replay a "no records found" answer from cache.
      // The data may now exist (e.g. date query was previously broken) so we
      // must always re-run the tool call for these responses.
      if (isEmptyResultResponse(cached.response)) {
        logger.warn(
          { promptHash, knowledgeId: cached.knowledgeId },
          'AI Memory: Redis entry is an empty-result response — evicting and falling through to OpenAI',
        );
        await invalidateCachedResponse(promptHash);
        // Fall through to vector search / OpenAI
      } else if (requestedDates.size > 0) {
        const responseLower = cached.response.toLowerCase();
        const allDatesPresent = [...requestedDates].every((d) => responseLower.includes(d));
        if (!allDatesPresent) {
          logger.warn(
            { promptHash, requestedDates: Array.from(requestedDates) },
            'AI Memory: Redis entry date mismatch — evicting poisoned cache entry',
          );
          await invalidateCachedResponse(promptHash);
          // Fall through to vector search
        } else {
          logger.info({ promptHash, knowledgeId: cached.knowledgeId }, 'AI Memory: Redis HIT');
          return {
            hit: true,
            source: 'redis',
            response: cached.response,
            confidence: 1.0,
            responseType: 'direct',
            knowledgeId: cached.knowledgeId,
            lookupMs: Date.now() - startMs,
            ...base,
          };
        }
      } else {
        logger.info({ promptHash, knowledgeId: cached.knowledgeId }, 'AI Memory: Redis HIT');
        return {
          hit: true,
          source: 'redis',
          response: cached.response,
          confidence: 1.0,
          responseType: 'direct',
          knowledgeId: cached.knowledgeId,
          lookupMs: Date.now() - startMs,
          ...base,
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Redis cache check failed — continuing to vector search');
  }

  // ── 2. Qdrant vector similarity search ───────────────────────────────────
  try {
    const { vector } = await generateEmbedding(normalizedPrompt);
    const vectorResults = await searchSimilarKnowledge(vector, 3);
    const guardedResults =
      requestedDates.size === 0
        ? vectorResults
        : vectorResults.filter((candidate) => {
            const candidateDates = extractDatesFromNormalizedPrompt(candidate.normalizedPrompt);
            for (const date of requestedDates) {
              if (!candidateDates.has(date)) return false;
            }
            return true;
          });

    if (vectorResults.length > 0 && guardedResults.length === 0 && requestedDates.size > 0) {
      logger.info(
        { requestedDates: Array.from(requestedDates), candidateCount: vectorResults.length },
        'AI Memory: semantic candidates rejected due to date mismatch',
      );
    }

    if (guardedResults.length > 0) {
      const best = guardedResults[0];

      logger.info(
        { score: best.score, knowledgeId: best.knowledgeId, intentCategory: best.intentCategory },
        'AI Memory: Qdrant candidate found',
      );

      const responseType: 'direct' | 'validated' | 'miss' =
        best.score >= env.AI_MEMORY_DIRECT_THRESHOLD
          ? 'direct'
          : best.score >= env.AI_MEMORY_SIMILARITY_THRESHOLD
            ? 'validated'
            : 'miss';

      if (responseType !== 'miss') {
        // Empty-result guard: if the Qdrant candidate itself is a cached
        // "no records" answer, skip it entirely so OpenAI re-runs the tools.
        if (isEmptyResultResponse(best.responsePreview)) {
          logger.warn(
            { knowledgeId: best.knowledgeId, score: best.score },
            'AI Memory: Qdrant candidate is an empty-result response — skipping, routing to OpenAI',
          );
          // Do not warm Redis with this stale entry — fall through to OpenAI
        } else {
          // Warm the Redis cache so future identical queries skip Qdrant
          await setCachedResponse(promptHash, {
            response: best.responsePreview,
            knowledgeId: best.knowledgeId,
            confidence: best.score,
            intentCategory: best.intentCategory,
          });

          // Async hit count increment — non-blocking
          incrementVectorHitCount(best.id).catch((e) =>
            logger.warn({ err: e }, 'vectorHitCount increment failed'),
          );

          return {
            hit: true,
            source: 'qdrant',
            response: best.responsePreview,
            confidence: best.score,
            responseType,
            knowledgeId: best.knowledgeId,
            vectorId: best.id,
            lookupMs: Date.now() - startMs,
            ...base,
          };
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Vector search failed — falling through to OpenAI');
  }

  // ── 3. Cache miss ─────────────────────────────────────────────────────────
  logger.debug({ promptHash, intentCategory }, 'AI Memory: MISS — routing to OpenAI');
  return {
    hit: false,
    source: 'none',
    responseType: 'miss',
    lookupMs: Date.now() - startMs,
    ...base,
  };
}

// ─── Learning ─────────────────────────────────────────────────────────────────

/**
 * Prepares a LearningPayload envelope for the BullMQ worker.
 * This is a synchronous helper — actual storage is done asynchronously.
 *
 * @returns A payload object ready to enqueue on the ai-learning queue.
 */
export function buildLearningPayload(opts: {
  originalPrompt: string;
  response: string;
  sqlResult?: unknown;
  userId: string;
  toolCallsCount: number;
  memoryResult: MemoryQueryResult;
}): LearningPayload {
  return {
    knowledgeId: uuidv4(),
    originalPrompt: opts.originalPrompt,
    normalizedPrompt: opts.memoryResult.normalizedPrompt,
    promptHash: opts.memoryResult.promptHash,
    intentCategory: opts.memoryResult.intentCategory,
    response: opts.response,
    sqlResult: opts.sqlResult,
    userId: opts.userId,
    toolCallsCount: opts.toolCallsCount,
  };
}

/**
 * Formats the response for "validated" hits (score 0.85–0.95).
 * Adds a brief transparency note so users understand the answer
 * comes from a similar (not identical) previous query.
 */
export function formatValidatedResponse(response: string, score: number): string {
  const pct = Math.round(score * 100);
  return `**Note:** This answer is based on a similar question (${pct}% match).\n\n${response}`;
}
