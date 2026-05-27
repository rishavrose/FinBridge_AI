/**
 * Tool-Result Sidecar Store
 *
 * Keeps a per-conversation ring buffer of recent MCP tool outputs SEPARATE
 * from the natural-language chat history. Two reasons:
 *
 *   1. Validation — the hallucination validator needs the raw tool results
 *      to check that numbers in the model's reply actually appear in the data.
 *
 *   2. Context separation — when injecting context for the next turn, we can
 *      pass a compact "recent data snapshots" block instead of interleaving
 *      full tool result JSON in the chat history. This prevents the model
 *      from mixing data from different turns.
 *
 * Storage: Redis, key `ai:tools:<conversationId>` → JSON ToolResultEntry[]
 * TTL: 1 hour (active session)
 * Max entries kept: 8 most recent (newest first)
 */

import { getRedisClient } from '../../cache/client.js';
import { logger } from '../../utils/logger.js';

const TOOL_RESULTS_KEY_PREFIX = 'ai:tools:';
const TOOL_RESULTS_TTL_SECONDS = 3600;
const MAX_ENTRIES = 8;
/** Per-result JSON size cap (chars) — avoid blowing Redis on giant rows. */
const MAX_RESULT_CHARS = 8000;

export interface ToolResultEntry {
  /** ISO timestamp of when the tool ran */
  at: string;
  /** Tool name (e.g. "query_finbridge_payouts") */
  tool: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Truncated JSON-stringified result */
  resultJson: string;
  /** Optional generated SQL for query_* tools */
  sql?: string;
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

export async function getRecentToolResults(
  conversationId: string,
): Promise<ToolResultEntry[]> {
  const redis = getRedisClient();
  try {
    const raw = await redis.get(`${TOOL_RESULTS_KEY_PREFIX}${conversationId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ToolResultEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.debug({ err, conversationId }, 'tool-results: read failed');
    return [];
  }
}

export async function appendToolResults(
  conversationId: string,
  newEntries: ToolResultEntry[],
): Promise<void> {
  if (newEntries.length === 0) return;
  const redis = getRedisClient();
  try {
    const existing = await getRecentToolResults(conversationId);
    const merged = [...newEntries, ...existing].slice(0, MAX_ENTRIES);
    await redis.setex(
      `${TOOL_RESULTS_KEY_PREFIX}${conversationId}`,
      TOOL_RESULTS_TTL_SECONDS,
      JSON.stringify(merged),
    );
  } catch (err) {
    logger.debug({ err, conversationId }, 'tool-results: write failed');
  }
}

/** Builds a tool-result entry from raw values, truncating oversized payloads. */
export function buildToolResultEntry(opts: {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  sql?: string;
}): ToolResultEntry {
  let resultJson: string;
  try {
    resultJson = JSON.stringify(opts.result);
  } catch {
    resultJson = String(opts.result);
  }
  if (resultJson.length > MAX_RESULT_CHARS) {
    resultJson = resultJson.slice(0, MAX_RESULT_CHARS) + '…[truncated]';
  }
  return {
    at: new Date().toISOString(),
    tool: opts.tool,
    args: opts.args,
    resultJson,
    sql: opts.sql,
  };
}

// ─── Prompt rendering ─────────────────────────────────────────────────────────

/**
 * Renders the recent tool results as a compact context block for the system
 * prompt. Returns null when there's nothing useful to inject.
 *
 * Format:
 *
 *   RECENT TOOL DATA SNAPSHOTS (newest first):
 *   [1] query_finbridge_payouts(filters={status:4})
 *       → {"count": 47, "sum_amount": 128500}
 *   [2] query_finbridge_settlements(filters={addeddate: "2026-05-26"})
 *       → {"count": 12, ...}
 */
export function renderToolResultsForPrompt(
  entries: ToolResultEntry[],
  maxChars = 4000,
): string | null {
  if (entries.length === 0) return null;

  const lines: string[] = ['RECENT TOOL DATA SNAPSHOTS (newest first — this is the ONLY trusted data source):'];
  let used = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const argsStr = JSON.stringify(e.args);
    const head = `[${i + 1}] ${e.tool}(${argsStr})`;
    const body = `    → ${e.resultJson}`;
    const block = `${head}\n${body}`;
    if (used + block.length > maxChars) {
      lines.push(`… (${entries.length - i} older snapshot(s) omitted)`);
      break;
    }
    lines.push(block);
    used += block.length;
  }

  return lines.join('\n');
}
