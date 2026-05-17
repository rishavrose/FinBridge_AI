/**
 * AI Learning Workers — BullMQ Async Processing
 *
 * Manages the "ai-learning" BullMQ queue that persists new knowledge
 * entries asynchronously after an OpenAI response is returned to the user.
 *
 * Worker pipeline (per job):
 *  1. Generate embedding for normalised prompt
 *  2. Upsert vector in Qdrant
 *  3. Store full knowledge entry in MySQL (ai_knowledge)
 *  4. Store embedding metadata in MySQL (ai_embeddings)
 *  5. Set Redis exact cache
 *
 * Keeping this out of the request path ensures sub-100 ms responses
 * even when the first call triggers a multi-step learning pipeline.
 */

import { Queue, Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { generateEmbedding } from '../embeddings/index.js';
import { upsertKnowledgeVector, buildVectorPoint } from '../vector/index.js';
import { setCachedResponse } from '../cache/index.js';
import { executeWrite } from '../../database/client.js';
import type { LearningPayload } from '../memory/index.js';

// ─── Redis connection (reuse env config) ──────────────────────────────────────

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
};

// ─── Queue definition ─────────────────────────────────────────────────────────

/**
 * The ai-learning queue accepts LearningPayload jobs.
 * Jobs are retried up to QUEUE_ATTEMPTS times with exponential back-off.
 */
export const aiLearningQueue = new Queue<LearningPayload>('ai-learning', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: env.QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.QUEUE_BACKOFF_MS },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// ─── Worker ───────────────────────────────────────────────────────────────────

let _learningWorker: Worker<LearningPayload> | null = null;

/**
 * Starts the ai-learning worker.
 * Idempotent — safe to call multiple times.
 */
export function startAiLearningWorker(): void {
  if (_learningWorker) return;

  _learningWorker = new Worker<LearningPayload>(
    'ai-learning',
    async (job) => {
      const data = job.data;
      logger.debug(
        { jobId: job.id, knowledgeId: data.knowledgeId, intent: data.intentCategory },
        'AI learning job started',
      );

      // ── Step 1: Generate embedding ────────────────────────────────────────
      const { vector, model, totalTokens } = await generateEmbedding(data.normalizedPrompt);

      // ── Step 2: Upsert in Qdrant ──────────────────────────────────────────
      const point = buildVectorPoint({
        knowledgeId: data.knowledgeId,
        vector,
        normalizedPrompt: data.normalizedPrompt,
        response: data.response,
        intentCategory: data.intentCategory,
        confidence: 1.0,
        promptHash: data.promptHash,
      });
      await upsertKnowledgeVector(point);

      // ── Step 3: Persist to MySQL ai_knowledge ─────────────────────────────
      await executeWrite(
        `INSERT INTO ai_knowledge
           (id, original_prompt, normalized_prompt, prompt_hash, response,
            sql_result, embedding_id, intent_category, hit_count, confidence, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1.000, ?)
         ON DUPLICATE KEY UPDATE
           hit_count   = hit_count + 1,
           updated_at  = NOW()`,
        [
          data.knowledgeId,
          data.originalPrompt,
          data.normalizedPrompt,
          data.promptHash,
          data.response,
          data.sqlResult ? JSON.stringify(data.sqlResult) : null,
          data.knowledgeId, // embedding_id references Qdrant point UUID
          data.intentCategory,
          JSON.stringify({ userId: data.userId, toolCallsCount: data.toolCallsCount }),
        ],
      );

      // ── Step 4: Persist embedding metadata to MySQL ai_embeddings ─────────
      await executeWrite(
        `INSERT IGNORE INTO ai_embeddings (id, knowledge_id, qdrant_id, model, dimensions)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), data.knowledgeId, data.knowledgeId, model, env.AI_EMBEDDING_DIMENSIONS],
      );

      // ── Step 5: Warm Redis exact cache ────────────────────────────────────
      await setCachedResponse(data.promptHash, {
        response: data.response,
        knowledgeId: data.knowledgeId,
        confidence: 1.0,
        intentCategory: data.intentCategory,
      });

      logger.info(
        {
          jobId: job.id,
          knowledgeId: data.knowledgeId,
          intent: data.intentCategory,
          tokens: totalTokens,
        },
        'AI learning job completed',
      );
    },
    {
      connection: redisConnection,
      concurrency: env.QUEUE_CONCURRENCY,
    },
  );

  _learningWorker.on('error', (err) => logger.error({ err }, 'AI learning worker error'));
  _learningWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'AI learning job failed'),
  );

  logger.info('AI learning worker started');
}

/**
 * Gracefully shuts down the ai-learning worker and queue.
 * Called by the server shutdown handler.
 */
export async function closeAiWorkers(): Promise<void> {
  if (_learningWorker) {
    await _learningWorker.close();
    _learningWorker = null;
  }
  await aiLearningQueue.close();
  logger.info('AI learning worker and queue closed');
}

/**
 * Enqueues a learning job.
 * Non-blocking — returns immediately after adding the job to Redis.
 */
export async function enqueueLearning(payload: LearningPayload): Promise<void> {
  try {
    await aiLearningQueue.add('learn', payload, {
      // Deduplicate by promptHash so rapid identical queries don't create duplicate jobs
      jobId: `learn:${payload.promptHash}:${Date.now()}`,
    });
    logger.debug({ knowledgeId: payload.knowledgeId }, 'AI learning job enqueued');
  } catch (err) {
    // Non-critical — the response has already been returned to the user
    logger.warn({ err }, 'Failed to enqueue AI learning job');
  }
}
