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
import { getOpenAiClient, getActiveModel } from '../../openai/client.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { countTokens } from '../context/tokenizer.js';

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
  /\b(this|that)\s+(issue|problem|error|failure|case|result|data|record|payout|transaction|utr|rrn|reference|ref|id|number)\b/i,
  // Short follow-up questions (≤ 8 words) are almost always contextual
  /^(why|how|what|when|where|who|which)\b.{0,40}\??\s*$/i,
  // Drill-down patterns
  /\b(drill\s*down|break\s*(it\s*)?down|more\s*detail|elaborate|explain)\b/i,
  // Anaphoric references
  /\b(the\s+(ones?|results?|records?|entries?|items?))\b/i,
  // Correction / recheck signals — user is telling AI its last answer was wrong
  /\b(wrong|incorrect|not\s+right|that'?s\s+wrong|this\s+is\s+wrong|recheck|check\s+again|try\s+again|verify\s+again|look\s+again|search\s+again)\b/i,
  // Continuation openers
  /^(and\s+(for|what\s+about|regarding)|also\s+(for|check)|now\s+(check|look|find))\b/i,
  // Specific reference lookups that are continuations of a session
  /\b(and\s+for\s+(this|that)|for\s+this\s+(utr|rrn|ref|id|number))\b/i,
];

/**
 * Returns true if the message likely references something from prior context.
 * Used to skip the prompt-hash semantic cache for follow-up questions.
 */
export function isContextualMessage(message: string): boolean {
  const trimmed = message.trim();
  return CONTEXTUAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ─── Live-analytics detection ────────────────────────────────────────────────

/**
 * Words that signal the user wants a FRESH, real-time reading rather than a
 * cached one. When matched we MUST bypass the semantic cache so the response
 * comes from a live MCP/database tool call.
 *
 * Example bug this fixes:
 *   User asks "Current payout success rate?" → cached answer from 10 min ago.
 *   User says  "recheck"                     → live answer, slightly higher
 *                                              counts because the DB grew.
 *   Without this detector the FIRST answer is misleadingly stale.
 */
const LIVE_PATTERNS: RegExp[] = [
  /\b(current|live|latest|now|right\s+now|real[\s-]?time|fresh|today'?s?|as\s+of\s+now)\b/i,
  /\b(tps|throughput\s+per\s+second|requests\s+per\s+second)\b/i,
  /\b(last\s+(hour|minute|few\s+minutes))\b/i,
  // Recheck / correction signals always force a fresh query
  /\b(recheck|check\s+again|verify\s+again|look\s+again|search\s+again|try\s+again|wrong|incorrect|not\s+right)\b/i,
];

/** Subjects that, combined with a LIVE word, must always be re-queried. */
const ANALYTICS_SUBJECTS: RegExp[] = [
  /\bpayout(s)?\b/i,
  /\btransaction(s)?\b/i,
  /\bsettlement(s)?\b/i,
  /\bsuccess\s+rate\b/i,
  /\bfailure\s+rate\b/i,
  /\bfailed\b/i,
  /\bsuccess(ful)?\b/i,
  /\bbalance(s)?\b/i,
  /\bmerchant(s)?\b/i,
  /\bbank(s)?\b/i,
  /\bdowntime|outage|incident\b/i,
  /\bcount|total|sum|amount\b/i,
  /\banalytics|metric|kpi|stat(s|istics)?\b/i,
];

/**
 * True if the message asks for a real-time analytic. These queries must
 * ALWAYS bypass the semantic cache and force a fresh MCP tool call —
 * cached values become stale as soon as the DB ticks forward.
 */
export function isLiveAnalyticsQuery(message: string): boolean {
  const trimmed = message.trim();
  const hasLiveWord = LIVE_PATTERNS.some((p) => p.test(trimmed));
  const hasAnalyticsSubject = ANALYTICS_SUBJECTS.some((p) => p.test(trimmed));

  // "current payout success rate" → live word + subject → live analytics
  if (hasLiveWord && hasAnalyticsSubject) return true;

  // Pure subjects without a temporal qualifier can be served from cache —
  // unless the subject itself is intrinsically real-time (TPS, success rate).
  if (/\b(tps|success\s+rate|failure\s+rate)\b/i.test(trimmed)) return true;

  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessageRow {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/** Real tokenizer-backed count; falls back to length/4 on encoder error. */
function estimateTokens(text: string): number {
  return countTokens(text);
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
      model: getActiveModel(),
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
          role: 'user',
          content: `[Earlier conversation summary for context: ${summary}]`,
        },
        ...recent,
      ];
    }
  } catch (err) {
    logger.warn({ err }, 'Conversation summarisation failed — falling back to token pruning');
  }

  return pruneToTokenBudget(messages, MAX_CONTEXT_TOKENS);
}
