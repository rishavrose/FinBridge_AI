/**
 * Per-Query Model Router
 *
 * Routes each chat turn to the right model tier:
 *
 *   - SIMPLE    : short follow-ups, greetings, low-stakes "what is X" (cheap)
 *   - REASONING : "why", "explain", multi-hop analytics (more capable)
 *   - STRICT    : strong-grounding fintech ops — money amounts, counts (most capable)
 *
 * Tier model names come from env. If a tier-specific var is unset, the router
 * falls back to the provider's default model (OPENAI_MODEL / NVIDIA_MODEL),
 * so this layer is no-op unless you actually configure tier models.
 */

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export type ModelTier = 'simple' | 'reasoning' | 'strict';

interface ClassifyInput {
  /** The user's message */
  message: string;
  /** Whether the prior turns contain financial data (changes tier toward strict) */
  hasFinancialContext?: boolean;
  /** Number of prior turns in conversation */
  historyLength?: number;
}

// ─── Classification ───────────────────────────────────────────────────────────

const ANALYTICAL_RE = /^\s*(why|how come|explain|describe|analyse|analyze|what\s+caused|what's\s+causing|reason\s+for|root\s+cause)/i;
const QUANTITATIVE_RE = /^\s*(show|list|count|how\s+many|total|sum|average|fetch|get|display)/i;
const FINTECH_WRITE_LIKE_RE = /\b(balance|amount|settle|payout\s+amount|sum|total\s+₹|total\s+amount|reconcil)/i;
const GREETING_RE = /^\s*(hi|hello|hey|thanks|thank\s+you|ok|okay|got\s+it|cool)[\s,.!?]*$/i;

export function classifyMessage(input: ClassifyInput): ModelTier {
  const msg = input.message.trim();

  if (GREETING_RE.test(msg) || msg.length < 8) return 'simple';
  // Money / balance / settlement questions go to STRICT — these are the
  // questions where hallucinated numbers cost the most.
  if (FINTECH_WRITE_LIKE_RE.test(msg)) return 'strict';
  // Analytical questions go to REASONING.
  if (ANALYTICAL_RE.test(msg)) return 'reasoning';
  // Multi-step quantitative questions in deep conversations go to REASONING.
  if (QUANTITATIVE_RE.test(msg) && (input.historyLength ?? 0) > 6) return 'reasoning';
  // Default — straightforward quantitative or unclassified.
  return 'simple';
}

// ─── Tier → model resolution ─────────────────────────────────────────────────

export function modelForTier(tier: ModelTier): string {
  const isNvidia = env.AI_PROVIDER === 'nvidia';
  const fallback = isNvidia ? env.NVIDIA_MODEL : env.OPENAI_MODEL;

  if (isNvidia) {
    switch (tier) {
      case 'simple':    return env.NVIDIA_MODEL_SIMPLE    ?? fallback;
      case 'reasoning': return env.NVIDIA_MODEL_REASONING ?? fallback;
      case 'strict':    return env.NVIDIA_MODEL_STRICT    ?? fallback;
    }
  }
  switch (tier) {
    case 'simple':    return env.OPENAI_MODEL_SIMPLE    ?? fallback;
    case 'reasoning': return env.OPENAI_MODEL_REASONING ?? fallback;
    case 'strict':    return env.OPENAI_MODEL_STRICT    ?? fallback;
  }
}

/** One-shot helper used by chatWithTools. */
export function pickModel(input: ClassifyInput): { tier: ModelTier; model: string } {
  const tier = classifyMessage(input);
  const model = modelForTier(tier);
  logger.debug({ tier, model, message: input.message.slice(0, 80) }, 'model-router: picked tier');
  return { tier, model };
}
