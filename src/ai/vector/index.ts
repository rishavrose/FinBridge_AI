/**
 * Vector Similarity Search — Qdrant Integration
 *
 * Provides CRUD operations for the AI knowledge vector store.
 *
 * Search confidence tiers (configured via env):
 *  ≥ AI_MEMORY_DIRECT_THRESHOLD    (default 0.95) → return response directly
 *  ≥ AI_MEMORY_SIMILARITY_THRESHOLD (default 0.85) → return response with validation note
 *  < AI_MEMORY_SIMILARITY_THRESHOLD                 → cache miss, call OpenAI
 *
 * Each stored point payload mirrors the ai_knowledge MySQL row so that
 * either system can be used as the source of truth.
 */

import { getQdrantClient } from './client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VectorSearchResult {
  /** Qdrant point UUID */
  id: string;
  /** Cosine similarity score [0, 1] */
  score: number;
  /** ai_knowledge.id (may differ from Qdrant UUID) */
  knowledgeId: string;
  normalizedPrompt: string;
  /** First 500 chars of the cached response (full version is in MySQL) */
  responsePreview: string;
  intentCategory: string;
  hitCount: number;
  confidence: number;
  promptHash: string;
}

export interface VectorPoint {
  /** UUID — acts as both Qdrant point ID and ai_knowledge.id */
  id: string;
  vector: number[];
  payload: {
    knowledgeId: string;
    normalizedPrompt: string;
    /** Truncated to 500 chars to keep Qdrant payload lean */
    responsePreview: string;
    intentCategory: string;
    hitCount: number;
    confidence: number;
    promptHash: string;
    createdAt: string;
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Searches the knowledge collection for the most similar prompt vector.
 *
 * Returns up to `limit` results whose cosine score meets AI_MEMORY_SIMILARITY_THRESHOLD.
 * Returns an empty array when Qdrant is unavailable (fail-open).
 */
export async function searchSimilarKnowledge(
  queryVector: number[],
  limit = 3,
): Promise<VectorSearchResult[]> {
  try {
    const client = getQdrantClient();

    const results = await client.search(env.QDRANT_COLLECTION, {
      vector: queryVector,
      limit,
      score_threshold: env.AI_MEMORY_SIMILARITY_THRESHOLD,
      with_payload: true,
    });

    if (!results.length) {
      logger.debug('Qdrant search: no results above similarity threshold');
      return [];
    }

    logger.debug(
      { count: results.length, topScore: results[0]?.score },
      'Qdrant search results',
    );

    return results
      .filter((r) => r.payload) // Guard against points without payload
      .map((r) => {
        const p = r.payload as VectorPoint['payload'];
        return {
          id: String(r.id),
          score: r.score,
          knowledgeId: p.knowledgeId,
          normalizedPrompt: p.normalizedPrompt,
          responsePreview: p.responsePreview,
          intentCategory: p.intentCategory,
          hitCount: p.hitCount ?? 0,
          confidence: p.confidence ?? r.score,
          promptHash: p.promptHash,
        };
      });
  } catch (err) {
    // Fail-open: a Qdrant error must not block the user
    logger.error({ err }, 'Qdrant search error — treating as vector miss');
    return [];
  }
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Stores a new knowledge vector in Qdrant.
 * Uses the provided `id` (ai_knowledge.id) as the Qdrant point ID for
 * deterministic lookups and deduplication.
 */
export async function upsertKnowledgeVector(point: VectorPoint): Promise<void> {
  try {
    const client = getQdrantClient();

    await client.upsert(env.QDRANT_COLLECTION, {
      points: [
        {
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        },
      ],
    });

    logger.debug({ id: point.id, intentCategory: point.payload.intentCategory }, 'Qdrant point upserted');
  } catch (err) {
    logger.error({ err, id: point.id }, 'Qdrant upsert error — knowledge not stored in vector DB');
    throw err; // Re-throw so the calling worker can handle/retry
  }
}

/**
 * Increments the hit_count in the Qdrant point payload.
 * Called each time a cached knowledge entry is served.
 */
export async function incrementVectorHitCount(pointId: string): Promise<void> {
  try {
    const client = getQdrantClient();
    // Qdrant payload update — increment requires a fetch-then-set pattern
    const [existing] = await client.retrieve(env.QDRANT_COLLECTION, {
      ids: [pointId],
      with_payload: true,
    });

    if (!existing?.payload) return;

    const currentHitCount = (existing.payload as VectorPoint['payload']).hitCount ?? 0;

    await client.setPayload(env.QDRANT_COLLECTION, {
      points: [pointId],
      payload: { hitCount: currentHitCount + 1 },
    });
  } catch (err) {
    // Non-critical — just log and continue
    logger.warn({ err, pointId }, 'Qdrant hitCount increment failed');
  }
}

/**
 * Deletes a knowledge vector from Qdrant.
 * Called when a knowledge entry is invalidated or receives negative feedback.
 */
export async function deleteKnowledgeVector(pointId: string): Promise<void> {
  try {
    const client = getQdrantClient();
    await client.delete(env.QDRANT_COLLECTION, { points: [pointId] });
    logger.info({ pointId }, 'Qdrant point deleted');
  } catch (err) {
    logger.error({ err, pointId }, 'Qdrant delete error');
  }
}

/**
 * Helper: build a VectorPoint object ready for upsert.
 */
export function buildVectorPoint(opts: {
  knowledgeId: string;
  vector: number[];
  normalizedPrompt: string;
  response: string;
  intentCategory: string;
  confidence: number;
  promptHash: string;
}): VectorPoint {
  return {
    id: opts.knowledgeId,
    vector: opts.vector,
    payload: {
      knowledgeId: opts.knowledgeId,
      normalizedPrompt: opts.normalizedPrompt,
      responsePreview: opts.response.slice(0, 500),
      intentCategory: opts.intentCategory,
      hitCount: 1,
      confidence: opts.confidence,
      promptHash: opts.promptHash,
      createdAt: new Date().toISOString(),
    },
  };
}
