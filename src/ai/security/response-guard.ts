/**
 * Response Guard — enforces grounding before a reply is sent.
 *
 * Builds on `validateGrounding` (which already extracts numbers / currency /
 * IDs / dates from the reply and matches them against tool output). The
 * validator currently just LOGS unsupported facts; this guard decides
 * whether to actually BLOCK the reply.
 *
 * Block policy (conservative — favors safety over flow):
 *   - If any **currency** fact is unsupported → BLOCK. Currency values are
 *     the highest-impact hallucinations in a fintech assistant.
 *   - If any **ID** fact is unsupported → BLOCK. Made-up payout/transaction
 *     IDs can send users chasing ghosts.
 *   - If ≥ 2 generic **number** facts are unsupported AND the reply is
 *     financial in nature (mentions amount / total / payout / etc.) → BLOCK.
 *   - Otherwise → PASS (with a warning logged by the validator).
 *
 * Blocked replies are replaced with a generic safe answer; the original
 * is emitted to the audit log + structured logger for offline review.
 */

import type { ValidationResult } from '../validation/hallucination-validator.js';
import { logger } from '../../utils/logger.js';

export const UNVERIFIED_DATA_FALLBACK =
  'Unable to retrieve verified data currently.';

const FINANCIAL_REPLY_PATTERN =
  /\b(amount|total|sum|payout|settlement|balance|transaction|count|rate|volume|merchant)\b/i;

export interface GuardInput {
  reply: string;
  validation: ValidationResult | null | undefined;
}

export interface GuardResult {
  /** Final reply to send to the user (may be replaced if blocked). */
  reply: string;
  /** True if we replaced the reply with the safe fallback. */
  blocked: boolean;
  /** Why the block fired (or undefined if it didn't). */
  reason?: string;
}

export function guardResponse(input: GuardInput): GuardResult {
  const { reply, validation } = input;

  // No validation available (no tools called this turn) → nothing to do.
  if (!validation || validation.grounded) {
    return { reply, blocked: false };
  }

  const unsupported = validation.unsupported ?? [];
  if (unsupported.length === 0) {
    return { reply, blocked: false };
  }

  // ── Block triggers ────────────────────────────────────────────────────────
  const unsupportedCurrency = unsupported.filter((u) => u.kind === 'currency');
  const unsupportedIds = unsupported.filter((u) => u.kind === 'id');
  const unsupportedNumbers = unsupported.filter((u) => u.kind === 'number');

  let blockReason: string | undefined;

  if (unsupportedCurrency.length > 0) {
    blockReason = `unsupported currency value(s): ${unsupportedCurrency
      .map((u) => u.value)
      .join(', ')}`;
  } else if (unsupportedIds.length > 0) {
    blockReason = `unsupported ID value(s): ${unsupportedIds
      .map((u) => u.value)
      .join(', ')}`;
  } else if (
    unsupportedNumbers.length >= 2 &&
    FINANCIAL_REPLY_PATTERN.test(reply)
  ) {
    blockReason = `${unsupportedNumbers.length} unsupported numeric values in a financial reply`;
  }

  if (!blockReason) {
    // Validator unhappy but our policy doesn't escalate → pass through.
    return { reply, blocked: false };
  }

  logger.warn(
    {
      event: 'ai.security.response_blocked',
      reason: blockReason,
      originalReply: reply.slice(0, 400),
      unsupported,
    },
    'AI security: response blocked by grounding guard',
  );

  return {
    reply: UNVERIFIED_DATA_FALLBACK,
    blocked: true,
    reason: blockReason,
  };
}
