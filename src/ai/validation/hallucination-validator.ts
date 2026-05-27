/**
 * Hallucination Validator
 *
 * The model has just produced a reply. Before we send it to the user, we
 * extract every "fact" that COULD be hallucinated — numeric values, currency
 * amounts, IDs, status codes — and check that each one is grounded in the
 * actual tool-result JSON we collected during this turn.
 *
 * If unsupported facts are found:
 *   - For NUMERIC values: flag the reply as untrusted. The caller can either
 *     reject + retry with an "abstain" instruction, or annotate the reply.
 *   - For IDS: same — the model should not invent transaction or payout IDs.
 *
 * This is intentionally a *grounding check*, not a semantic-correctness check.
 * The cheapest, most reliable anti-hallucination signal is: "did this number
 * exist in the data we just queried?"
 *
 * Important: validation only runs when toolCallsExecuted > 0. If the model
 * answered without calling a tool (e.g. greeting, refusal, abstain), there
 * is nothing to ground against.
 */

import { logger } from '../../utils/logger.js';

export interface ValidationFinding {
  /** What kind of fact failed grounding */
  kind: 'number' | 'currency' | 'id' | 'date';
  /** The exact substring extracted from the reply */
  value: string;
  /** Optional normalised form (e.g. number with commas stripped) */
  normalized?: string;
}

export interface ValidationResult {
  /** True if every extracted fact is grounded in the tool data */
  grounded: boolean;
  /** Total facts checked */
  checked: number;
  /** Facts that could not be grounded */
  unsupported: ValidationFinding[];
  /** Human-readable diagnostic */
  reason: string;
}

// ─── Extraction patterns ──────────────────────────────────────────────────────

/**
 * Numbers with at least 2 digits — single-digit numbers are far too common in
 * prose ("1 way to fix this", "the 2 main causes") to validate reliably and
 * almost never represent fabricated metrics.
 */
const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{2,}(?:\.\d+)?\b/g;
/** Currency amounts — must reach the validator from the data. */
const CURRENCY_RE = /[₹$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\s?(?:₹|INR|USD|EUR|GBP)\b/gi;
/** Transaction / payout / settlement IDs — alphanum strings 6+ chars with ≥1 digit. */
const ID_RE = /\b(?:TXN|PAYOUT|SETT|PYT|UPI|REF|UTR)[-_]?[A-Z0-9]{5,}\b/gi;
/** ISO and DD-MM-YYYY dates the model might quote. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[\/-]\d{2}[\/-]\d{4}\b/g;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeNumeric(s: string): string {
  return s.replace(/[,₹$€£\sINRUSDEURGBP]/gi, '');
}

/**
 * Heuristics for "this number is so common it would be in any text" —
 * dates, percentages near 0/100, status codes for known values.
 */
function isCommonNumber(s: string): boolean {
  const n = parseFloat(normalizeNumeric(s));
  if (!Number.isFinite(n)) return true;
  // Known status code constants we already document in the system prompt
  if ([1, 2, 4, 6, 8].includes(n)) return true;
  // Plain percentages 0–100 with no decimal — too generic
  if (Number.isInteger(n) && n >= 0 && n <= 100 && s.length <= 3) return true;
  // Years 2020–2030
  if (Number.isInteger(n) && n >= 2020 && n <= 2035) return true;
  return false;
}

/**
 * Checks if a numeric value is present in the haystack, tolerating thousand
 * separators and decimal-point differences. Looks for the raw digits.
 */
function numericMatchesHaystack(value: string, haystack: string): boolean {
  const norm = normalizeNumeric(value);
  if (!norm) return false;
  if (haystack.includes(norm)) return true;
  // Try without trailing .00 / .0
  const stripped = norm.replace(/\.0+$/, '');
  if (stripped !== norm && haystack.includes(stripped)) return true;
  // Try with .00 appended (some sums come back as integers, model writes 1500.00)
  if (!norm.includes('.') && haystack.includes(`${norm}.`)) return true;
  return false;
}

function dedupe<T extends { value: string; kind: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = `${x.kind}|${x.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates that every extractable fact in `reply` appears in `toolResultsJoined`.
 *
 * `toolResultsJoined` should be the concatenation of every tool-result JSON
 * payload captured during this turn (the validator just does substring +
 * normalized lookups against it).
 */
export function validateGrounding(
  reply: string,
  toolResultsJoined: string,
): ValidationResult {
  if (!reply.trim()) {
    return { grounded: true, checked: 0, unsupported: [], reason: 'empty reply — nothing to validate' };
  }
  if (!toolResultsJoined.trim()) {
    return {
      grounded: true,
      checked: 0,
      unsupported: [],
      reason: 'no tool results available — validation skipped',
    };
  }

  const haystack = toolResultsJoined;
  const unsupported: ValidationFinding[] = [];
  let checked = 0;

  // Numbers
  for (const match of reply.matchAll(NUMBER_RE)) {
    const v = match[0];
    if (isCommonNumber(v)) continue;
    checked++;
    if (!numericMatchesHaystack(v, haystack)) {
      unsupported.push({ kind: 'number', value: v, normalized: normalizeNumeric(v) });
    }
  }
  // Currency
  for (const match of reply.matchAll(CURRENCY_RE)) {
    const v = match[0];
    checked++;
    if (!numericMatchesHaystack(v, haystack)) {
      unsupported.push({ kind: 'currency', value: v, normalized: normalizeNumeric(v) });
    }
  }
  // IDs
  for (const match of reply.matchAll(ID_RE)) {
    const v = match[0];
    checked++;
    if (!haystack.toUpperCase().includes(v.toUpperCase())) {
      unsupported.push({ kind: 'id', value: v });
    }
  }
  // Dates
  for (const match of reply.matchAll(DATE_RE)) {
    const v = match[0];
    checked++;
    if (!haystack.includes(v)) {
      unsupported.push({ kind: 'date', value: v });
    }
  }

  const deduped = dedupe(unsupported);
  const grounded = deduped.length === 0;

  return {
    grounded,
    checked,
    unsupported: deduped,
    reason: grounded
      ? `All ${checked} extracted facts grounded in tool results`
      : `${deduped.length} of ${checked} facts NOT found in tool results`,
  };
}

/**
 * Convenience: joins a list of tool-result JSON strings into a single
 * haystack for validation. Pass the raw JSON content of every `role: 'tool'`
 * message that was produced during this chat round.
 */
export function joinToolResults(jsonStrings: string[]): string {
  return jsonStrings.filter(Boolean).join('\n');
}

/** Logs a structured warning when grounding fails. Helps offline review. */
export function logUngroundedReply(
  conversationId: string,
  userMessage: string,
  reply: string,
  result: ValidationResult,
): void {
  if (result.grounded) return;
  logger.warn(
    {
      event: 'ai.hallucination_detected',
      conversationId,
      userMessage: userMessage.slice(0, 200),
      reply: reply.slice(0, 400),
      checked: result.checked,
      unsupported: result.unsupported,
    },
    `Hallucination detected: ${result.unsupported.length} ungrounded facts in reply`,
  );
}
