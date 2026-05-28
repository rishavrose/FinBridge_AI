/**
 * Refusal policy & zero-result protection.
 *
 * - `CANNED_REFUSAL` is the only string used when a query is blocked.
 *   It's deliberately short, generic, and architecture-blind — no mention
 *   of tools, tables, MCP, or "alternatives".
 *
 * - `scrubZeroResultLeak` runs AFTER the model produces a reply. If every
 *   tool call this turn returned empty AND the model still added a
 *   "would you like top X instead?" style follow-up, we drop that
 *   suggestion and replace the reply with a flat empty-result message.
 *   Section 3 of the brief.
 */

import type { ToolCallTrace } from '../../openai/converter.js';

export const CANNED_REFUSAL =
  "I can't help with that request.";

export const DOMAIN_REFUSAL =
  'I can only assist with fintech operations and payment-related analytics.';

/** Patterns that indicate the model is offering an unsafe alternative. */
const ALTERNATIVE_OFFER_PATTERNS: RegExp[] = [
  /\bwould\s+you\s+like\s+(me\s+to\s+)?(see|fetch|show|list|view)\b/i,
  /\b(i\s+can|i\s+could|let\s+me)\s+(show|fetch|list|provide|pull)\s+/i,
  // "instead" near a ranking word — works whether the punctuation/spacing
  // is "instead?", "instead.", "instead,", or just "instead "
  /\b(top|biggest|recent|similar|related|other)\b[^.?!\n]{0,80}?\binstead\b/i,
  /\binstead\b[^.?!\n]{0,80}?\b(top|biggest|recent|similar|related|other)\b/i,
  /\balternatively\b.{0,120}?(merchant|user|account|payout|transaction|top|biggest)/i,
  /\bhere\s+are\s+(some\s+)?(similar|related|nearby|top|biggest)\b/i,
  // "try (the/some) top/biggest" — articles are optional
  /\btry\s+(asking\s+)?(for\s+)?(the\s+|some\s+|a\s+)?(top|biggest|recent|all|similar)\b/i,
];

/** Heuristic: did any tool this turn return a row payload? */
function anyToolReturnedData(traces: ToolCallTrace[], toolResultsRaw: string[]): boolean {
  if (traces.length === 0) return true; // No tools called → not a zero-result situation.
  if (toolResultsRaw.length === 0) return false;
  for (const raw of toolResultsRaw) {
    try {
      const parsed = JSON.parse(raw) as { rows?: unknown[]; result?: Record<string, unknown> };
      if (Array.isArray(parsed.rows) && parsed.rows.length > 0) return true;
      if (parsed.result && Object.keys(parsed.result).length > 0) {
        // Aggregate result (COUNT/SUM) — only counts as "has data" if the
        // count is non-zero. Otherwise it's effectively empty.
        const count = (parsed.result as { count?: unknown }).count;
        if (typeof count === 'number' && count > 0) return true;
        if (typeof count === 'string' && Number(count) > 0) return true;
        // Non-count aggregates (sum/avg) — if any numeric value is > 0 treat
        // as data.
        for (const v of Object.values(parsed.result)) {
          if (typeof v === 'number' && v !== 0) return true;
          if (typeof v === 'string' && Number(v) > 0) return true;
        }
      }
    } catch {
      // Unparseable payloads conservatively count as "has data" so we don't
      // suppress legitimate replies.
      return true;
    }
  }
  return false;
}

export interface ScrubInput {
  reply: string;
  toolCallsTrace: ToolCallTrace[];
  /** Raw tool result JSON strings as fed back to the model this turn. */
  toolResultsRaw: string[];
}

export interface ScrubResult {
  reply: string;
  scrubbed: boolean;
}

/**
 * If every tool returned empty AND the model is suggesting alternatives,
 * replace the reply with a flat "No matching records found." line.
 */
export function scrubZeroResultLeak(input: ScrubInput): ScrubResult {
  const { reply, toolCallsTrace, toolResultsRaw } = input;

  if (anyToolReturnedData(toolCallsTrace, toolResultsRaw)) {
    return { reply, scrubbed: false };
  }

  const hasOffer = ALTERNATIVE_OFFER_PATTERNS.some((p) => p.test(reply));
  if (!hasOffer) {
    return { reply, scrubbed: false };
  }

  return { reply: 'No matching records found.', scrubbed: true };
}
