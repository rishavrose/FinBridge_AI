/**
 * Conversation Context Manager
 *
 * Provides short-term conversational memory so the AI can answer follow-up
 * questions that reference prior turns. Example:
 *
 *   Turn 1 — User:  "show failed payouts"
 *             AI:   "Failed Payouts: 47, Total Amount: ₹128,500"
 *   Turn 2 — User:  "why are they failing?"
 *             AI:   [knows "they" = the failed payouts from Turn 1]
 *
 * Architecture:
 *   L1 — Redis  : hot session cache, 30-min TTL, updated after every turn
 *   L2 — MySQL  : source of truth, queried on Redis miss / server restart
 *
 * On long conversations (> SUMMARIZE_THRESHOLD messages) older turns are
 * compressed into a single summary system message to stay within token budget.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { getRedisClient } from '../../cache/client.js';
import { executeSelect } from '../../database/client.js';
import { getOpenAiClient } from '../../openai/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_CACHE_PREFIX = 'ai:ctx:';
const CONTEXT_CACHE_TTL = 1800;   // 30 min — active conversation window
const MAX_DB_MESSAGES = 20;        // Max messages to fetch from DB per call
const MAX_CONTEXT_TOKENS = 6000;   // Approx token budget reserved for history
const SUMMARIZE_THRESHOLD = 16;    // Compress when stored message count exceeds this

// ─── Contextual reference detection ─────────────────────────────────────────

/**
 * Patterns that indicate the user is referring to something from a prior turn.
 * When matched, the semantic cache is bypassed so OpenAI can use conversation
 * history to resolve the reference correctly.
 */
const CONTEXTUAL_PATTERNS: RegExp[] = [
  /\b(they|them|their|those|these)\b/i,
  /\b(it|its)\b/i,
  /\bthe\s+(above|previous|last|same|earlier|prior)\b/i,
  /\b(again|also|another|other|else|more)\b/i,
  /\b(this|that)\s+(issue|problem|error|failure|case|result|data|record|payout|transaction)\b/i,
  // Short follow-up questions (≤ 8 words) are almost always contextual
  /^(why|how|what|when|where|who|which)\b.{0,40}\??\s*$/i,
  // Drill-down patterns
  /\b(drill\s*down|break\s*(it\s*)?down|more\s*detail|elaborate|explain)\b/i,
  // Anaphoric references
  /\b(the\s+(ones?|results?|records?|entries?|items?))\b/i,
];

/**
 * Returns true if the message likely references something from prior context.
 * Used to skip the prompt-hash semantic cache for follow-up questions.
 */
export function isContextualMessage(message: string): boolean {
  const trimmed = message.trim();
  return CONTEXTUAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessageRow {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/** Rough estimate used for context pruning. Actual tokenisation varies by model. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Context loading ──────────────────────────────────────────────────────────

/**
 * Returns the ordered conversation history for injection into an OpenAI call.
 *
 * Call this BEFORE saving the current user message so the returned messages
 * represent only the prior turns (not the message being processed now).
 *
 * Priority: Redis (L1) → MySQL (L2).
 */
export async function getConversationContext(
  conversationId: string,
): Promise<ChatCompletionMessageParam[]> {
  const redis = getRedisClient();
  const cacheKey = `${CONTEXT_CACHE_PREFIX}${conversationId}`;

  // ── L1: Redis ──────────────────────────────────────────────────────────────
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ChatCompletionMessageParam[];
      logger.debug({ conversationId, count: parsed.length }, 'Conversation context: Redis hit');
      return parsed;
    }
  } catch (err) {
    logger.warn({ err, conversationId }, 'Conversation context: Redis read error — falling back to DB');
  }

  // ── L2: MySQL ─────────────────────────────────────────────────────────────
  const rows = await executeSelect<ChatMessageRow>(
    `SELECT role, content
     FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ${MAX_DB_MESSAGES}`,
    [conversationId],
  );

  if (rows.length === 0) {
    return [];
  }

  const messages: ChatCompletionMessageParam[] = rows.map((row) => ({
    role: row.role,
    content: row.content,
  }));

  const optimized =
    messages.length > SUMMARIZE_THRESHOLD
      ? await compressHistory(messages)
      : pruneToTokenBudget(messages, MAX_CONTEXT_TOKENS);

  // Warm Redis so the next request hits L1
  try {
    await redis.setex(cacheKey, CONTEXT_CACHE_TTL, JSON.stringify(optimized));
  } catch {
    // Non-fatal
  }

  logger.debug(
    { conversationId, rawCount: rows.length, optimizedCount: optimized.length },
    'Conversation context: DB load',
  );
  return optimized;
}

// ─── Cache update ─────────────────────────────────────────────────────────────

/**
 * Appends the latest user+assistant exchange to the Redis context cache.
 *
 * Called after every successful AI response. Keeps the L1 cache current so
 * the next request doesn't need to hit MySQL.
 * Silently ignores Redis errors — a cache miss is handled gracefully on the
 * next getConversationContext() call.
 */
export async function appendToContextCache(
  conversationId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = `${CONTEXT_CACHE_PREFIX}${conversationId}`;

  try {
    const cached = await redis.get(cacheKey);
    const messages: ChatCompletionMessageParam[] = cached
      ? (JSON.parse(cached) as ChatCompletionMessageParam[])
      : [];

    messages.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantReply },
    );

    const pruned = pruneToTokenBudget(messages, MAX_CONTEXT_TOKENS);
    await redis.setex(cacheKey, CONTEXT_CACHE_TTL, JSON.stringify(pruned));
  } catch {
    // Non-fatal
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Trims the oldest messages from the front of the list until the total
 * estimated token count is within budget. Newest messages are always kept.
 */
function pruneToTokenBudget(
  messages: ChatCompletionMessageParam[],
  tokenBudget: number,
): ChatCompletionMessageParam[] {
  let totalTokens = 0;
  const result: ChatCompletionMessageParam[] = [];

  // Walk backwards (newest first) and include messages until budget is full
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = typeof messages[i].content === 'string' ? (messages[i].content as string) : '';
    const tokens = estimateTokens(content);

    if (totalTokens + tokens > tokenBudget && result.length > 0) break;
    result.unshift(messages[i]);
    totalTokens += tokens;
  }

  return result;
}

/**
 * Compresses a long conversation by summarising old turns.
 *
 * Keeps the 8 most recent messages verbatim (highest context value) and
 * replaces everything before them with a concise summary system message.
 * Falls back to pruneToTokenBudget() if the OpenAI call fails.
 */
async function compressHistory(
  messages: ChatCompletionMessageParam[],
): Promise<ChatCompletionMessageParam[]> {
  if (!env.OPENAI_API_KEY || messages.length <= 8) {
    return pruneToTokenBudget(messages, MAX_CONTEXT_TOKENS);
  }

  const keepRecent = 8;
  const toSummarize = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(messages.length - keepRecent);

  try {
    const client = getOpenAiClient();
    const transcript = toSummarize
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : ''}`)
      .join('\n');

    const summaryResp = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Summarise this fintech support conversation in 3-4 sentences. ' +
            'Focus on: which data was queried (tables/filters used), key metrics returned, ' +
            'and any ongoing investigation or issue. Be factual and concise.',
        },
        { role: 'user', content: transcript },
      ],
      max_completion_tokens: 400,
    });

    const summary = summaryResp.choices[0]?.message?.content ?? '';

    if (summary) {
      return [
        {
          role: 'system',
          content: `[Earlier conversation summary: ${summary}]`,
        },
        ...recent,
      ];
    }
  } catch (err) {
    logger.warn({ err }, 'Conversation summarisation failed — falling back to token pruning');
  }

  return pruneToTokenBudget(messages, MAX_CONTEXT_TOKENS);
}
