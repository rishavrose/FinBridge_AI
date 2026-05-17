/**
 * AI Cache Analytics
 *
 * Records and exposes performance metrics for the AI memory system:
 *  - Per-request cache log writes to MySQL (ai_cache_logs table)
 *  - In-memory rolling counters for the /health endpoint and dashboards
 *
 * All DB writes are fire-and-forget to avoid blocking the response path.
 */

import { v4 as uuidv4 } from 'uuid';
import { executeWrite } from '../../database/client.js';
import { logger } from '../../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CacheSource = 'redis' | 'qdrant' | 'openai';

export interface CacheLogEntry {
  promptHash: string;
  cacheSource: CacheSource;
  hit: boolean;
  confidence?: number;
  responseMs: number;
}

export interface CacheStats {
  totalRequests: number;
  redisHits: number;
  qdrantHits: number;
  openaiCalls: number;
  hitRate: number;
  avgResponseMs: number;
}

// ─── In-memory counters ────────────────────────────────────────────────────────
// Lightweight rolling counters — reset on server restart.
// For production persistence, these should be written to Redis or Prometheus.

const _counters = {
  total: 0,
  redisHits: 0,
  qdrantHits: 0,
  openaiCalls: 0,
  totalResponseMs: 0,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Records a single cache interaction to both in-memory counters and the
 * ai_cache_logs MySQL table. Non-blocking — errors are logged and swallowed.
 */
export async function recordCacheLog(entry: CacheLogEntry): Promise<void> {
  // Update in-memory counters synchronously
  _counters.total++;
  _counters.totalResponseMs += entry.responseMs;
  if (entry.hit) {
    if (entry.cacheSource === 'redis') _counters.redisHits++;
    else if (entry.cacheSource === 'qdrant') _counters.qdrantHits++;
  } else {
    _counters.openaiCalls++;
  }

  // Persist to MySQL asynchronously
  executeWrite(
    `INSERT INTO ai_cache_logs (id, prompt_hash, cache_source, hit, confidence, response_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      entry.promptHash,
      entry.cacheSource,
      entry.hit ? 1 : 0,
      entry.confidence ?? null,
      entry.responseMs,
    ],
  ).catch((err) => logger.warn({ err }, 'ai_cache_logs write failed'));
}

/**
 * Returns aggregated cache performance stats from the in-memory counters.
 */
export function getCacheStats(): CacheStats {
  const { total, redisHits, qdrantHits, openaiCalls, totalResponseMs } = _counters;
  const hits = redisHits + qdrantHits;
  return {
    totalRequests: total,
    redisHits,
    qdrantHits,
    openaiCalls,
    hitRate: total > 0 ? hits / total : 0,
    avgResponseMs: total > 0 ? Math.round(totalResponseMs / total) : 0,
  };
}

/**
 * Records an AI chat history entry in MySQL for training / audit purposes.
 */
export async function recordChatHistory(opts: {
  userId: string;
  conversationId: string | null;
  originalPrompt: string;
  normalizedPrompt: string;
  promptHash: string;
  response: string;
  cacheHit: boolean;
  cacheSource: CacheSource;
  confidenceScore: number | null;
  responseMs: number;
  toolCallsCount: number;
}): Promise<void> {
  executeWrite(
    `INSERT INTO ai_chat_history
       (id, user_id, conversation_id, original_prompt, normalized_prompt,
        prompt_hash, response, cache_hit, cache_source, confidence_score,
        response_ms, tool_calls_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      opts.userId,
      opts.conversationId,
      opts.originalPrompt,
      opts.normalizedPrompt,
      opts.promptHash,
      opts.response,
      opts.cacheHit ? 1 : 0,
      opts.cacheSource,
      opts.confidenceScore,
      opts.responseMs,
      opts.toolCallsCount,
    ],
  ).catch((err) => logger.warn({ err }, 'ai_chat_history write failed'));
}
