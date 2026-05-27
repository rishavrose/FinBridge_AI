/**
 * Token counting using a real BPE tokenizer (js-tiktoken).
 *
 * Replaces the older `text.length / 4` estimator. The estimator was off by
 * 20-40% on fintech responses (currency symbols, numeric tables) which caused
 * either wasted context budget or accidental truncation.
 *
 * NVIDIA NIM models do NOT use the OpenAI tokenizer — but cl100k_base gets
 * within ~10% on most modern LLMs, which is good enough for budgeting.
 */

import { encodingForModel, getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { logger } from '../../utils/logger.js';

let _encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (_encoder) return _encoder;
  try {
    _encoder = encodingForModel('gpt-4o');
  } catch {
    _encoder = getEncoding('cl100k_base');
  }
  return _encoder;
}

/** Token count for a single string. Falls back to a length estimate on error. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return getEncoder().encode(text).length;
  } catch (err) {
    logger.debug({ err }, 'tokenizer encode failed — falling back to estimate');
    return Math.ceil(text.length / 4);
  }
}

/**
 * Token count for a list of chat messages, including the per-message overhead
 * that OpenAI charges (~4 tokens for role/name framing).
 */
export function countMessagesTokens(messages: ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // role + framing overhead
    const content = typeof m.content === 'string' ? m.content : '';
    total += countTokens(content);
    if ('name' in m && typeof m.name === 'string') total += countTokens(m.name);
    if ('tool_call_id' in m && typeof m.tool_call_id === 'string') total += 6;
  }
  return total + 2; // priming tokens
}
