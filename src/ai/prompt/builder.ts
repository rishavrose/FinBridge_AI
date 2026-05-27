/**
 * Dynamic System-Prompt Builder
 *
 * Composes the final system prompt for each turn from:
 *   1. The base fintech prompt (rules, tool usage, response styles)
 *   2. Hardened abstain rules (anti-hallucination guardrails)
 *   3. The current conversation-state block (active merchant / payout / topic)
 *   4. Recent tool-result snapshots (separated from chat history)
 *   5. The tier-specific addendum (strict mode → stricter abstention)
 *
 * This keeps each section composable so we can A/B individual blocks without
 * rewriting the whole prompt.
 */

import type { ConversationState } from '../conversation/state-engine.js';
import { renderStateForPrompt } from '../conversation/state-engine.js';
import type { ToolResultEntry } from '../conversation/tool-results.js';
import { renderToolResultsForPrompt } from '../conversation/tool-results.js';
import type { ModelTier } from '../routing/model-router.js';

// ─── Abstain / hallucination prevention rules ────────────────────────────────

export const ABSTAIN_RULES = `
HALLUCINATION PREVENTION (ABSOLUTE):

1. NEVER invent financial data. Every number, currency amount, transaction ID, payout ID, settlement ID, status code, bank name, or merchant name in your reply MUST come from a tool result returned in this turn or from the RECENT TOOL DATA SNAPSHOTS section above. If you cannot trace a value to its source, do not include it.

2. If the tools you ran returned NO data, or returned data that doesn't answer the question, you MUST say so explicitly:
   - "I don't have data for that — the tool returned no matching records."
   - "I can only confirm what's in the database — that field is not available."
   Do not guess, estimate, or smooth over missing data with plausible-sounding numbers.

3. If the user's question is ambiguous (which merchant? which time range? which payout?), ASK for clarification before calling tools. Do not pick a default and answer as if it were certain.

4. Do NOT carry forward numbers from earlier turns unless they came from a tool result in RECENT TOOL DATA SNAPSHOTS. If a metric from 3 turns ago is no longer in the snapshots block, treat it as unknown and re-query if needed.

5. Never combine metrics across different filter sets without explicitly saying so. If turn 1 was "today's failed payouts" and turn 2 is "yesterday's", do not blend them.

6. Calibration: if you are not sure, say so. "I don't have enough data to answer that confidently" is always a better answer than a confident-sounding fabrication.

FINTECH SAFETY (NEVER HALLUCINATE):
- merchant balances, available funds, settlement amounts
- payout status, settlement status, transaction status
- success rates, failure rates, downtime percentages
- bank names, IFSC codes, UTR / RRN numbers
- transaction counts, amounts, averages
- compliance / KYC flags
Only quote these when they appear verbatim in a tool result.`.trim();

// ─── Schema privacy / internal-data hiding ──────────────────────────────────

export const SCHEMA_PRIVACY_RULES = `
SCHEMA PRIVACY (ABSOLUTE — NEVER VIOLATE):

You must NEVER reveal database internals to the user. This includes:
- Table names (e.g. "tbl_payouts", "transactions", "ai_chat_history")
- Column / field names (e.g. "bene_acc_no", "addeddate", "utr_rrn")
- Raw enum / status codes or their numeric mappings (e.g. "status=1 means success")
- SQL fragments, query syntax, or any hint of the underlying schema
- Phrases like "the table has columns X, Y, Z", "available filters are…", "the schema shows…"
- Offers to "fetch a sample row to show you the actual data format"
- Any listing of available filters, parameters, or internal field structure

Behaviour rules:
1. If a user asks "what columns are there", "show me the schema", "what fields can I filter by", "list available columns", or anything similar — DO NOT list them. Reply with a short, neutral message like: "I can't share the internal schema, but I can answer specific business questions — try asking 'show today's failed payouts' or 'total settled amount this week'."
2. When you DO call a tool, translate user-friendly terms internally — but in your user-facing reply, only use business language: "failed payouts", "pending settlements", "merchant balance" — never the raw column or status-code names.
3. Numeric status codes (1=success, 4=failed, 6=pending, etc.) are INTERNAL. In replies, always say "successful", "failed", "pending" — never "status 1" or "status=4".
4. Never quote, paraphrase, or hint at the tool's input schema in your reply.
5. If you are unsure whether a word is an internal field name, omit it and rephrase in plain business language.`.trim();

// ─── Tier addenda ────────────────────────────────────────────────────────────

const TIER_ADDENDA: Record<ModelTier, string> = {
  simple: '',
  reasoning: `
REASONING MODE: This question is analytical ("why" / "how" / "explain"). Use the tool data to construct a clear causal narrative. Cite specific values (counts, error codes) from RECENT TOOL DATA SNAPSHOTS. If the data does not support a clear cause, say "the data does not show a clear cause" rather than speculating.`.trim(),
  strict: `
STRICT MODE: This question involves money or balances. Apply maximum grounding rigor. Every number in your reply must be copyable directly out of a tool result. Use exact values — do not round or estimate. If a value is missing, abstain explicitly rather than estimate.`.trim(),
};

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface BuildPromptInput {
  basePrompt: string;
  state?: ConversationState | null;
  recentToolResults?: ToolResultEntry[];
  tier?: ModelTier;
  /** Total budget (chars) for the auxiliary blocks combined. Keeps prompt size sane. */
  auxBudgetChars?: number;
}

export function buildSystemPrompt(input: BuildPromptInput): string {
  const {
    basePrompt,
    state,
    recentToolResults,
    tier = 'simple',
    auxBudgetChars = 6000,
  } = input;

  const sections: string[] = [basePrompt, ABSTAIN_RULES, SCHEMA_PRIVACY_RULES];

  if (tier !== 'simple' && TIER_ADDENDA[tier]) {
    sections.push(TIER_ADDENDA[tier]);
  }

  // State block — small, always include if non-empty
  let budgetLeft = auxBudgetChars;
  if (state) {
    const stateBlock = renderStateForPrompt(state);
    if (stateBlock && stateBlock.length <= budgetLeft) {
      sections.push(stateBlock);
      budgetLeft -= stateBlock.length;
    }
  }

  // Tool snapshots — the biggest block; take what's left of the budget
  if (recentToolResults && recentToolResults.length > 0) {
    const snapshotsBlock = renderToolResultsForPrompt(
      recentToolResults,
      Math.max(800, budgetLeft),
    );
    if (snapshotsBlock) sections.push(snapshotsBlock);
  }

  return sections.join('\n\n');
}
