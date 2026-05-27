/**
 * Environment Configuration
 * Validates all environment variables at startup with Zod.
 * The process exits immediately if any required variable is missing or invalid.
 */

import { z } from 'zod';
import { config } from 'dotenv';

config(); // Load .env file

// ─── Schema ──────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().optional(),

  // MySQL — use a READONLY database user
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.string().default('3306').transform(Number),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_CONNECTION_LIMIT: z.string().default('10').transform(Number),
  DB_ACQUIRE_TIMEOUT: z.string().default('30000').transform(Number),
  DB_WAIT_FOR_CONNECTIONS: z.string().default('true').transform((v) => v === 'true'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0').transform(Number),
  REDIS_KEY_PREFIX: z.string().default('finbridge:'),

  // Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_ISSUER: z.string().default('finbridge-mcp'),
  API_KEY_SALT: z.string().min(16, 'API_KEY_SALT must be at least 16 characters'),

  // AI Provider — switch between 'openai' and 'nvidia'
  AI_PROVIDER: z.enum(['openai', 'nvidia']).default('openai'),

  // OpenAI (optional)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4-turbo-preview'),
  OPENAI_MAX_TOKENS: z.string().default('4096').transform(Number),

  // NVIDIA NIM (optional — OpenAI-compatible endpoint)
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_MODEL: z.string().default('deepseek-ai/deepseek-v4-flash'),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),

  // Cache TTLs (seconds)
  CACHE_TTL_DEFAULT: z.string().default('300').transform(Number),
  CACHE_TTL_SCHEMA: z.string().default('3600').transform(Number),
  CACHE_TTL_BALANCE: z.string().default('60').transform(Number),
  CACHE_TTL_TRANSACTIONS: z.string().default('120').transform(Number),

  // Rate Limiting
  RATE_LIMIT_MAX: z.string().default('100').transform(Number),
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  LOG_PRETTY: z.string().default('false').transform((v) => v === 'true'),

  // MCP
  MCP_SERVER_NAME: z.string().default('finbridge-mcp'),
  MCP_SERVER_VERSION: z.string().default('1.0.0'),

  // Audit
  AUDIT_LOG_FILE: z.string().default('logs/audit.log'),
  AUDIT_RETENTION_DAYS: z.string().default('90').transform(Number),

  // Queue
  QUEUE_CONCURRENCY: z.string().default('5').transform(Number),
  QUEUE_ATTEMPTS: z.string().default('3').transform(Number),
  QUEUE_BACKOFF_MS: z.string().default('2000').transform(Number),

  // Dynamic DB connections
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32, 'CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters').default('finbridge-default-encryption-key-32chars!!'),

  // Qdrant Vector DB
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('finbridge_ai_knowledge'),

  // AI Memory / Semantic Cache
  AI_MEMORY_ENABLED: z.string().default('true').transform((v) => v === 'true'),
  AI_MEMORY_SIMILARITY_THRESHOLD: z.string().default('0.85').transform(Number),
  AI_MEMORY_DIRECT_THRESHOLD: z.string().default('0.95').transform(Number),
  AI_MEMORY_CACHE_TTL: z.string().default('3600').transform(Number),
  AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_EMBEDDING_DIMENSIONS: z.string().default('1536').transform(Number),
});

// ─── Validate ─────────────────────────────────────────────────────────────────

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌  Invalid environment variables detected. Fix these before starting:');
  console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

const rawEnv = result.data;

// AI Memory requires embeddings — needs at least one AI provider key.
const hasAiKey = rawEnv.AI_PROVIDER === 'nvidia'
  ? !!rawEnv.NVIDIA_API_KEY
  : !!rawEnv.OPENAI_API_KEY;

export const env = {
  ...rawEnv,
  AI_MEMORY_ENABLED: rawEnv.AI_MEMORY_ENABLED && hasAiKey,
};

export type Env = typeof env;
