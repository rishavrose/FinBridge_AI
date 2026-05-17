/**
 * Embedding Generation Module
 *
 * Wraps the OpenAI Embeddings API (text-embedding-3-small) with:
 *  - Singleton client reuse (shared with existing openai/client.ts)
 *  - Built-in retry handling (delegated to the OpenAI SDK)
 *  - Vector dimension validation
 *  - Structured logging
 *
 * Returns a Float32Array-compatible number[] vector of size
 * AI_EMBEDDING_DIMENSIONS (default: 1536).
 */

import { getOpenAiClient } from '../../openai/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  vector: number[];
  model: string;
  totalTokens: number;
}

// ─── Embedding generation ─────────────────────────────────────────────────────

/**
 * Generates a semantic embedding vector for the given text.
 *
 * Uses text-embedding-3-small by default (configurable via AI_EMBEDDING_MODEL).
 * The OpenAI SDK retries transient failures automatically (maxRetries: 3).
 *
 * @param text - Raw or normalised prompt text to embed.
 * @returns EmbeddingResult with vector, model name, and token usage.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const client = getOpenAiClient();
  const startMs = Date.now();

  const response = await client.embeddings.create({
    model: env.AI_EMBEDDING_MODEL,
    input: text,
    dimensions: env.AI_EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });

  const embedding = response.data[0];
  if (!embedding) {
    throw new Error('OpenAI returned no embedding data');
  }

  const vector = embedding.embedding;

  // Validate dimension integrity
  if (vector.length !== env.AI_EMBEDDING_DIMENSIONS) {
    logger.warn(
      { expected: env.AI_EMBEDDING_DIMENSIONS, received: vector.length },
      'Embedding dimension mismatch',
    );
  }

  logger.debug(
    {
      model: env.AI_EMBEDDING_MODEL,
      dimensions: vector.length,
      tokens: response.usage.total_tokens,
      ms: Date.now() - startMs,
    },
    'Embedding generated',
  );

  return {
    vector,
    model: response.model,
    totalTokens: response.usage.total_tokens,
  };
}

/**
 * Generates embeddings for a batch of texts in a single API call.
 * More efficient than calling generateEmbedding() in a loop.
 *
 * @param texts - Array of strings to embed (max 2048 items per OpenAI limit).
 */
export async function generateEmbeddingBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const client = getOpenAiClient();

  const response = await client.embeddings.create({
    model: env.AI_EMBEDDING_MODEL,
    input: texts,
    dimensions: env.AI_EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });

  const tokensPerItem = Math.ceil(response.usage.total_tokens / texts.length);

  return response.data.map((item) => ({
    vector: item.embedding,
    model: response.model,
    totalTokens: tokensPerItem,
  }));
}
