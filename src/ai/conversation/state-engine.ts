/**
 * Conversation State Engine
 *
 * Tracks the *currently-active* entities and topic across a conversation, so
 * the model doesn't drift when the user asks a follow-up like "and yesterday?"
 * or "show that merchant's payouts". Without this, the model has to re-derive
 * intent from raw chat history every turn and frequently mixes contexts.
 *
 * Persisted in Redis with a 24h TTL. State is rebuilt on Redis miss from the
 * most recent tool-call traces (best-effort — losing state is non-fatal, the
 * next turn will repopulate it).
 *
 * Storage key: `ai:state:<conversationId>` → JSON ConversationState
 */

import { getRedisClient } from '../../cache/client.js';
import { logger } from '../../utils/logger.js';
import type { ToolCallTrace } from '../../openai/converter.js';

const STATE_KEY_PREFIX = 'ai:state:';
const STATE_TTL_SECONDS = 86_400; // 24h

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationState {
  /** The high-level topic of the current thread: payouts | transactions | settlements | merchants | analytics | other */
  topic: string | null;
  /** The merchant the user is currently focused on (mid / merchantId) */
  activeMerchantId: string | null;
  /** The payout the user is currently focused on */
  activePayoutId: string | null;
  /** The transaction the user is currently focused on */
  activeTransactionId: string | null;
  /** Open / unresolved incident being discussed */
  activeIncident: string | null;
  /** Last filter set used in a tool call — drives "what about yesterday?" follow-ups */
  lastFilters: Record<string, unknown> | null;
  /** Last date range queried (used for relative follow-ups) */
  lastDateRange: { from: string; to: string } | null;
  /** Last set of tables touched */
  lastTables: string[];
  /** ISO timestamp of last update */
  updatedAt: string;
}

function emptyState(): ConversationState {
  return {
    topic: null,
    activeMerchantId: null,
    activePayoutId: null,
    activeTransactionId: null,
    activeIncident: null,
    lastFilters: null,
    lastDateRange: null,
    lastTables: [],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Load / Save ──────────────────────────────────────────────────────────────

export async function getConversationState(
  conversationId: string,
): Promise<ConversationState> {
  const redis = getRedisClient();
  try {
    const raw = await redis.get(`${STATE_KEY_PREFIX}${conversationId}`);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as ConversationState) };
  } catch (err) {
    logger.warn({ err, conversationId }, 'state-engine: read failed, returning empty');
    return emptyState();
  }
}

export async function saveConversationState(
  conversationId: string,
  state: ConversationState,
): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.setex(
      `${STATE_KEY_PREFIX}${conversationId}`,
      STATE_TTL_SECONDS,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
    );
  } catch (err) {
    logger.warn({ err, conversationId }, 'state-engine: write failed');
  }
}

// ─── State derivation ─────────────────────────────────────────────────────────

const TOPIC_PATTERNS: Array<{ topic: string; re: RegExp }> = [
  { topic: 'payouts',     re: /\bpayout/i },
  { topic: 'transactions', re: /\btransaction|\btxn|\bupi\b/i },
  { topic: 'settlements', re: /\bsettlement|\bsettle/i },
  { topic: 'merchants',   re: /\bmerchant|\bvendor/i },
  { topic: 'balances',    re: /\bbalance|\bwallet/i },
  { topic: 'analytics',   re: /\banalytics|\breport|\btrend/i },
  { topic: 'incidents',   re: /\bincident|\bdowntime|\boutage|\bfailure/i },
];

function detectTopic(userMessage: string): string | null {
  for (const { topic, re } of TOPIC_PATTERNS) {
    if (re.test(userMessage)) return topic;
  }
  return null;
}

/** Extracts a merchant ID like "M12345", "mid:12345", or "merchant 12345". */
function detectMerchantId(text: string): string | null {
  const patterns = [
    /\bmerchant[_\s]?id[:\s=]+["']?([\w-]+)/i,
    /\bmid[:\s=]+["']?([\w-]+)/i,
    /\bmerchant\s+([A-Z0-9]{4,})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function detectPayoutId(text: string): string | null {
  const patterns = [
    /\bpayout[_\s]?id[:\s=]+["']?([\w-]+)/i,
    /\bpid[:\s=]+["']?([\w-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function detectTransactionId(text: string): string | null {
  const patterns = [
    /\btxn[_\s]?id[:\s=]+["']?([\w-]+)/i,
    /\btransaction[_\s]?id[:\s=]+["']?([\w-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Updates the state by inspecting the user's message and the tool calls that
 * were executed for this turn. Both inputs are optional — missing inputs just
 * mean fewer fields get refreshed.
 */
export function deriveStateUpdates(
  prior: ConversationState,
  userMessage: string,
  toolCalls: ToolCallTrace[],
): ConversationState {
  const next: ConversationState = { ...prior };

  const detectedTopic = detectTopic(userMessage);
  if (detectedTopic) next.topic = detectedTopic;

  const merchant = detectMerchantId(userMessage);
  if (merchant) next.activeMerchantId = merchant;

  const payout = detectPayoutId(userMessage);
  if (payout) next.activePayoutId = payout;

  const txn = detectTransactionId(userMessage);
  if (txn) next.activeTransactionId = txn;

  // Inspect tool call args/SQL for filter context and table names
  const tablesTouched = new Set<string>();
  for (const t of toolCalls) {
    // query_<db>_<table> naming convention
    const m = t.name.match(/^query_[^_]+_(.+)$/);
    if (m) tablesTouched.add(m[1]);

    const args = t.args as Record<string, unknown> | undefined;
    if (args && typeof args === 'object') {
      const filters = args['filters'] as Record<string, unknown> | undefined;
      if (filters && typeof filters === 'object') {
        next.lastFilters = filters;
        // Pull merchant/payout ids from filters too
        for (const [k, v] of Object.entries(filters)) {
          if (typeof v !== 'string' && typeof v !== 'number') continue;
          if (/merchant/i.test(k)) next.activeMerchantId = String(v);
          if (/^payout/i.test(k) || /payout_?id/i.test(k)) next.activePayoutId = String(v);
        }
      }
      const ranges = args['filterRanges'] as Array<{ column: string; from: string; to: string }> | undefined;
      if (Array.isArray(ranges) && ranges.length > 0) {
        const dateRange = ranges.find((r) => /date|created_at|addeddate/i.test(r.column));
        if (dateRange) next.lastDateRange = { from: dateRange.from, to: dateRange.to };
      }
    }
  }
  if (tablesTouched.size > 0) next.lastTables = Array.from(tablesTouched);

  next.updatedAt = new Date().toISOString();
  return next;
}

// ─── Prompt rendering ─────────────────────────────────────────────────────────

/**
 * Renders the state as a compact, model-friendly block to inject into the
 * system prompt. Returns null if there is nothing useful to inject — avoids
 * polluting the prompt for fresh conversations.
 */
export function renderStateForPrompt(state: ConversationState): string | null {
  const lines: string[] = [];
  if (state.topic) lines.push(`- Active topic: ${state.topic}`);
  if (state.activeMerchantId) lines.push(`- Active merchant: ${state.activeMerchantId}`);
  if (state.activePayoutId) lines.push(`- Active payout: ${state.activePayoutId}`);
  if (state.activeTransactionId) lines.push(`- Active transaction: ${state.activeTransactionId}`);
  if (state.activeIncident) lines.push(`- Open incident: ${state.activeIncident}`);
  if (state.lastDateRange) {
    lines.push(`- Last date range: ${state.lastDateRange.from} → ${state.lastDateRange.to}`);
  }
  if (state.lastTables.length > 0) {
    lines.push(`- Recently queried tables: ${state.lastTables.join(', ')}`);
  }
  if (state.lastFilters && Object.keys(state.lastFilters).length > 0) {
    lines.push(`- Last filters used: ${JSON.stringify(state.lastFilters)}`);
  }
  if (lines.length === 0) return null;

  return [
    'CONVERSATION STATE (carries across turns — use to resolve follow-up references):',
    ...lines,
    'When the user says "they", "those", "that merchant", etc., resolve against the active entities above. Do not switch topics unless the new message clearly indicates one.',
  ].join('\n');
}
