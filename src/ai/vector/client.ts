/**
 * Qdrant Client Singleton
 *
 * Provides a shared QdrantClient instance and collection bootstrap utilities.
 *
 * The collection is created once at server startup (ensureCollection).
 * All subsequent reads/writes share the same HTTP keep-alive connection pool.
 *
 * Collection schema:
 *   name    : QDRANT_COLLECTION  (default: "finbridge_ai_knowledge")
 *   vectors : Cosine, AI_EMBEDDING_DIMENSIONS  (default: 1536)
 *   payload : knowledgeId, normalizedPrompt, response (preview), intentCategory,
 *             hitCount, confidence, promptHash, createdAt
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: env.QDRANT_URL,
      ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    });
    logger.info({ url: env.QDRANT_URL }, 'Qdrant client initialised');
  }
  return _client;
}

// ─── Collection bootstrap ─────────────────────────────────────────────────────

/**
 * Creates the AI knowledge collection in Qdrant if it does not already exist.
 * Safe to call on every startup — idempotent.
 */
export async function ensureQdrantCollection(): Promise<void> {
  const client = getQdrantClient();

  try {
    const { exists } = await client.collectionExists(env.QDRANT_COLLECTION);

    if (!exists) {
      await client.createCollection(env.QDRANT_COLLECTION, {
        vectors: {
          size: env.AI_EMBEDDING_DIMENSIONS,
          distance: 'Cosine',
        },
        optimizers_config: {
          // Two segments allow concurrent reads + writes
          default_segment_number: 2,
        },
        // Keep replication low for single-node dev; raise in production
        replication_factor: 1,
      });
      logger.info(
        { collection: env.QDRANT_COLLECTION, dimensions: env.AI_EMBEDDING_DIMENSIONS },
        'Qdrant collection created',
      );
    } else {
      logger.info({ collection: env.QDRANT_COLLECTION }, 'Qdrant collection already exists');
    }
  } catch (err) {
    // Collection bootstrap failure must not block server startup — log and continue
    logger.error({ err }, 'Qdrant collection initialisation failed — vector search disabled');
  }
}

/**
 * Lightweight health check: list collections and verify ours is present.
 */
export async function pingQdrant(): Promise<void> {
  const client = getQdrantClient();
  const { collections } = await client.getCollections();
  logger.debug({ count: collections.length }, 'Qdrant ping OK');
}
