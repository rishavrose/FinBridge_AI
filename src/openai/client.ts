/**
 * OpenAI client singleton.
 * Configured for function calling (tool use) mode.
 */

import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let _client: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  if (!_client) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    _client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      maxRetries: 3,
      timeout: 60_000,
    });
    logger.info({ model: env.OPENAI_MODEL }, 'OpenAI client initialised');
  }
  return _client;
}

export { env as openAiConfig };
