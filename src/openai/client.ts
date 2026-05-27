import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let _client: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  if (!_client) {
    if (env.AI_PROVIDER === 'nvidia') {
      if (!env.NVIDIA_API_KEY) {
        throw new Error('NVIDIA_API_KEY is not configured');
      }
      _client = new OpenAI({
        apiKey: env.NVIDIA_API_KEY,
        baseURL: env.NVIDIA_BASE_URL,
        maxRetries: 3,
        timeout: 60_000,
      });
      logger.info({ provider: 'nvidia', model: env.NVIDIA_MODEL }, 'NVIDIA NIM client initialised');
    } else {
      if (!env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured');
      }
      _client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        maxRetries: 3,
        timeout: 60_000,
      });
      logger.info({ provider: 'openai', model: env.OPENAI_MODEL }, 'OpenAI client initialised');
    }
  }
  return _client;
}

/** Active model name for the configured provider. */
export function getActiveModel(): string {
  return env.AI_PROVIDER === 'nvidia' ? env.NVIDIA_MODEL : env.OPENAI_MODEL;
}

/** Active max tokens for the configured provider. */
export function getActiveMaxTokens(): number {
  return env.OPENAI_MAX_TOKENS; // shared setting; add NVIDIA_MAX_TOKENS if needed
}

export { env as openAiConfig };
