/**
 * Prompt Normalization Module
 *
 * Converts semantically equivalent questions into a canonical form so that
 * the same or similar queries always produce the same cache key.
 *
 * Examples of inputs that normalise to the same key:
 *   "Why payout failed?"
 *   "why payout failed"
 *   "Payout failed reason"
 *   → "payout failed reason"
 *
 * The module also provides:
 *  - SHA-256 hashing for exact Redis cache keys
 *  - Intent detection for categorising fintech queries
 */

import { createHash } from 'crypto';

// ─── Stop-word list ───────────────────────────────────────────────────────────
// Common English function words that carry no semantic weight in fintech queries.
const STOP_WORDS = new Set([
  'why', 'how', 'what', 'when', 'where', 'who', 'which',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
  'but', 'not', 'no', 'can', 'could', 'should', 'would', 'will', 'shall',
  'do', 'does', 'did', 'done', 'doing',
  'my', 'our', 'your', 'their', 'its', 'his', 'her',
  'this', 'that', 'these', 'those',
  'me', 'us', 'you', 'him', 'her', 'them', 'it',
  'please', 'show', 'tell', 'give', 'get', 'find', 'list', 'check', 'fetch',
  'i', 'we', 'they', 'he', 'she', 'has', 'have', 'had',
  'about', 'with', 'from', 'into', 'through', 'during', 'by', 'as',
]);

// ─── Synonym map ──────────────────────────────────────────────────────────────
// Maps variant terms to canonical fintech vocabulary.
const SYNONYMS: Record<string, string> = {
  // Payout variants
  payment: 'payout',
  transfer: 'payout',
  disbursement: 'payout',
  // Transaction variants
  txn: 'transaction',
  tx: 'transaction',
  transactions: 'transaction',
  // Failure variants
  fail: 'failed',
  failing: 'failed',
  failure: 'failed',
  error: 'failed',
  unsuccessful: 'failed',
  decline: 'failed',
  declined: 'failed',
  reject: 'failed',
  rejected: 'failed',
  // Status synonyms
  down: 'outage',
  unavailable: 'outage',
  offline: 'outage',
  // Settlement variants
  settle: 'settlement',
  settling: 'settlement',
  settlements: 'settlement',
  // Bank variants
  banks: 'bank',
  // Merchant variants
  merchants: 'merchant',
  // Issue synonyms
  problem: 'issue',
  bug: 'issue',
  // Delay synonyms
  delayed: 'delay',
  delays: 'delay',
  // Pending synonyms
  stuck: 'pending',
  hanging: 'pending',
  // Balance synonyms
  balances: 'balance',
  wallet: 'balance',
  // Reconciliation variants
  recon: 'reconciliation',
  reconcile: 'reconciliation',
  // RRN variants
  retrieval: 'rrn',
};

// ─── Core normalization ────────────────────────────────────────────────────────

/**
 * Normalizes a raw user prompt into a canonical intent string.
 *
 * Pipeline:
 *   1. Lowercase + trim
 *   2. Strip punctuation
 *   3. Collapse whitespace
 *   4. Remove stop words (single-pass)
 *   5. Apply synonym mapping
 *   6. Re-join with single space
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .trim()
    // Remove all punctuation except alphanumerics and spaces
    .replace(/[^a-z0-9\s]/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .split(' ')
    // Drop tokens that are too short or are stop words
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    // Apply synonym normalisation
    .map((word) => SYNONYMS[word] ?? word)
    .join(' ')
    .trim();
}

/**
 * Produces a deterministic SHA-256 hex hash of the normalised prompt.
 * Used as the Redis cache key: `ai:cache:<hash>`.
 */
export function hashPrompt(normalizedPrompt: string): string {
  return createHash('sha256').update(normalizedPrompt).digest('hex');
}

// ─── Intent detection ─────────────────────────────────────────────────────────

/**
 * Maps a normalised prompt to one of the known fintech intent categories.
 * Used for analytics bucketing and smart cache eviction.
 */
export function detectIntent(prompt: string): string {
  const lower = prompt.toLowerCase();

  if ((lower.includes('payout') || lower.includes('payment')) &&
      (lower.includes('fail') || lower.includes('error') || lower.includes('reject'))) {
    return 'payout_failure';
  }
  if (lower.includes('transaction') &&
      (lower.includes('fail') || lower.includes('error') || lower.includes('decline'))) {
    return 'transaction_failure';
  }
  if (lower.includes('balance') || lower.includes('wallet')) return 'balance_inquiry';
  if (lower.includes('settlement')) return 'settlement_inquiry';
  if (lower.includes('bank') &&
      (lower.includes('down') || lower.includes('status') || lower.includes('health') || lower.includes('outage'))) {
    return 'bank_health';
  }
  if (lower.includes('merchant')) return 'merchant_inquiry';
  if (lower.includes('rrn') || lower.includes('retrieval')) return 'rrn_lookup';
  if (lower.includes('payout')) return 'payout_inquiry';
  if (lower.includes('transaction')) return 'transaction_inquiry';
  if (lower.includes('reconcil')) return 'reconciliation_inquiry';
  return 'general_inquiry';
}
