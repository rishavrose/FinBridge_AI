/**
 * Cache Safety — gate the semantic-learning pipeline.
 *
 * The AI memory layer stores `(prompt → response)` pairs in Qdrant and
 * replays them when a new prompt is similar enough. That's a HUGE
 * win for "how many failed payouts today" — the answer is identical
 * across users.
 *
 * But it's a privacy/correctness disaster for prompts like:
 *   "why did payout PAYOUT-184729 fail" → caches a user-specific answer
 *   "balance for merchant Acme Co"      → caches a counterparty's data
 *   "show me UTR 20230598471234"        → caches a single record
 *
 * If we cached those, the NEXT user asking a fuzzy-similar question
 * would get back the previous user's private answer. This module
 * decides whether a (prompt, response) pair is safe to learn.
 *
 * Default policy: opt-out. We assume cacheable, then look for any
 * disqualifying signal in either the prompt OR the response.
 */

// ─── Disqualifying signals in the user's prompt ──────────────────────────────

const PROMPT_DISQUALIFIERS: RegExp[] = [
  // Specific payout / transaction / settlement IDs
  /\b(PAYOUT|TXN|SETT|PYT|UPI|REF|UTR|RRN)[-_]?[A-Z0-9]{5,}\b/i,
  // Bare numeric IDs (6+ digits in a row are almost always identifiers)
  /\b\d{8,}\b/,
  // Account / IFSC / VPA references
  /\b(account|acc|a\/c|ifsc|vpa)\s*(no\.?|number|id)?\s*[:#=]?\s*[A-Z0-9@.]{4,}/i,
  // Named merchant lookups ("merchant Acme", "merchant ID 1234")
  // Use [A-Za-z0-9] for the first char so numeric merchant IDs are caught too.
  /\bmerchant\s+(id\s*[:#=]?\s*)?[A-Za-z0-9][A-Za-z0-9_.-]{2,}/i,
  // Phone / email / personal identifiers
  /\b\+?\d{10,13}\b/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

// ─── Disqualifying signals in the model's reply ──────────────────────────────

const REPLY_DISQUALIFIERS: RegExp[] = [
  // Same ID patterns — if the response NAMES a specific record, caching it
  // would replay that named record to other users.
  /\b(PAYOUT|TXN|SETT|PYT|UPI|REF|UTR|RRN)[-_]?[A-Z0-9]{5,}\b/i,
  /\b\d{8,}\b/,
  // Names of beneficiaries / customers ("To: John Doe", "Payee: …")
  /\b(beneficiary|payee|payer|sender|receiver|recipient|customer)\s*[:#=]\s*[A-Z][a-z]+/i,
  // VPA / IFSC / account number echoed back
  /\b[A-Z]{4}0[A-Z0-9]{6}\b/,                      // IFSC
  /\b[a-z0-9._-]+@[a-z]{3,}\b/i,                  // VPA-ish
];

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CacheabilityCheck {
  cacheable: boolean;
  /** Why we declined to cache (undefined if cacheable). */
  reason?: string;
  /** Which side flagged it. */
  source?: 'prompt' | 'reply';
}

export function isCacheable(prompt: string, reply: string): CacheabilityCheck {
  for (const re of PROMPT_DISQUALIFIERS) {
    const m = prompt.match(re);
    if (m) {
      return {
        cacheable: false,
        source: 'prompt',
        reason: `prompt references record-specific value: "${m[0].slice(0, 40)}"`,
      };
    }
  }

  for (const re of REPLY_DISQUALIFIERS) {
    const m = reply.match(re);
    if (m) {
      return {
        cacheable: false,
        source: 'reply',
        reason: `reply contains record-specific value: "${m[0].slice(0, 40)}"`,
      };
    }
  }

  return { cacheable: true };
}
