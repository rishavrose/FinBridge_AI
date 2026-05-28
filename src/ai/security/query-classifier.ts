/**
 * Query Classifier
 *
 * Deterministic, regex-based gate that runs BEFORE the AI is invoked. Tags
 * each prompt as `safe`, `sensitive`, or `high_risk` and explains why.
 *
 * - `high_risk`  → short-circuit with a canned refusal. No tool calls run.
 * - `sensitive` → tool calls run, but the turn is flagged in the audit log.
 * - `safe`      → normal flow.
 *
 * Phase 1 keeps this purely lexical/regex. Phase 2 will layer per-session
 * risk on top (repeated probing escalates to high_risk).
 */

export type Classification = 'safe' | 'sensitive' | 'high_risk';

export interface ClassifyResult {
  classification: Classification;
  reasons: string[];
  /** Subcategory hint for downstream policy (e.g. 'enumeration', 'schema_discovery'). */
  category?:
    | 'enumeration'
    | 'schema_discovery'
    | 'tool_discovery'
    | 'bulk_export'
    | 'operational_fishing'
    | 'general';
}

// ─── Pattern banks ────────────────────────────────────────────────────────────

/**
 * Merchant / user / account enumeration. Asking the AI to surface "top X",
 * "biggest Y", "list all Z" is the classic discovery-via-ranking attack — and
 * exactly the leak the user flagged in section 11.
 *
 * Note: these are matched against the FULL message, not just the keyword,
 * so phrasing like "show me today's biggest payouts by merchant" trips it.
 */
const ENUMERATION_PATTERNS: RegExp[] = [
  /\b(top|biggest|largest|highest)\s+\d*\s*(merchant|user|account|payout|transaction|customer|payer|payee|sender|receiver|recipient|client)s?\b/i,
  /\blist\s+(all|every|the)?\s*(merchant|user|account|customer|payer|payee|sender|receiver|recipient|client)s?\b/i,
  /\b(show|give)\s+me\s+(all|every|the)\s+(merchant|user|account|customer)s?\b/i,
  /\b(who|which)\s+(are\s+the\s+)?(top|biggest|largest|highest)\s+(merchant|user|account|customer|payer)s?\b/i,
  /\benumerate\s+(merchant|user|account)/i,
  /\brank(ing)?\s+of\s+(merchant|user|account|bank)/i,
];

/**
 * Schema / column / table discovery. Asking "what columns are there" reveals
 * the underlying data model. Even partial leaks (status code mappings, field
 * names) help an attacker craft targeted queries.
 */
const SCHEMA_DISCOVERY_PATTERNS: RegExp[] = [
  /\bwhat\s+(columns?|fields?|tables?|schemas?)\s+/i,
  /\b(list|show|describe|tell\s+me)\s+(the\s+)?(columns?|fields?|tables?|schemas?)\b/i,
  /\bavailable\s+(columns?|fields?|filters?|parameters?)\b/i,
  /\b(table|column|schema|database)\s+(structure|definition|layout)\b/i,
  /\bDESCRIBE\s+\w+/i,
  /\bSHOW\s+(TABLES|COLUMNS|CREATE)\b/i,
  /\binformation_schema\b/i,
  /\bwhat\s+can\s+i\s+filter\s+(by|on)\b/i,
];

/**
 * Tool / capability discovery. We do not want the AI advertising its own
 * inventory. Section 1 + 6 of the brief.
 */
const TOOL_DISCOVERY_PATTERNS: RegExp[] = [
  /\bwhat\s+(tools?|apis?|endpoints?|capabilities|functions?)\s+(do\s+you\s+have|are\s+available|can\s+you)\b/i,
  /\b(list|show)\s+(your\s+)?(tools?|capabilities|functions?|apis?)\b/i,
  /\bwhat\s+can\s+you\s+(do|access|query)\b/i,
  /\bMCP\s+(tools?|server|inventory)\b/i,
  /\bavailable\s+(tools?|capabilities)\b/i,
];

/**
 * Bulk export / dump intent. Always sensitive even if user has legitimate
 * access — should be a managed flow, not an ad-hoc AI prompt.
 */
const BULK_EXPORT_PATTERNS: RegExp[] = [
  /\b(export|download|dump|extract)\s+(all|every|the\s+entire|full)\s+/i,
  /\b(give|send)\s+me\s+(all|every)\s+(record|row|transaction|payout|user|merchant)s?\b/i,
  /\bfull\s+(database|dataset|export|dump)\b/i,
];

/**
 * Operational-intelligence fishing: probing weak banks, downtime windows,
 * exploit-adjacent reconnaissance.
 */
const OPS_FISHING_PATTERNS: RegExp[] = [
  /\b(which|what)\s+(bank|psp|gateway)s?\s+(are\s+)?(weakest|slowest|most\s+failing|down|offline|broken|exploit)/i,
  /\b(vulnerable|exploit|bypass|abuse|loophole)\b/i,
  /\b(when|what\s+time)\s+(are\s+)?(failure|outage|downtime)s?\s+highest\b/i,
];

// ─── Classifier ──────────────────────────────────────────────────────────────

function matchAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(message));
}

/**
 * Classify a user prompt for the AI security gate.
 *
 * Decision order matters:
 *   1. high_risk wins over sensitive (enumeration/schema/tool/ops fishing)
 *   2. sensitive (bulk export) only if no high_risk match
 *   3. safe otherwise
 */
export function classifyQuery(message: string): ClassifyResult {
  const reasons: string[] = [];

  if (matchAny(message, ENUMERATION_PATTERNS)) {
    reasons.push('matches merchant/user enumeration pattern');
    return { classification: 'high_risk', reasons, category: 'enumeration' };
  }

  if (matchAny(message, SCHEMA_DISCOVERY_PATTERNS)) {
    reasons.push('matches schema/column discovery pattern');
    return { classification: 'high_risk', reasons, category: 'schema_discovery' };
  }

  if (matchAny(message, TOOL_DISCOVERY_PATTERNS)) {
    reasons.push('matches tool/capability discovery pattern');
    return { classification: 'high_risk', reasons, category: 'tool_discovery' };
  }

  if (matchAny(message, OPS_FISHING_PATTERNS)) {
    reasons.push('matches operational-intelligence fishing pattern');
    return { classification: 'high_risk', reasons, category: 'operational_fishing' };
  }

  if (matchAny(message, BULK_EXPORT_PATTERNS)) {
    reasons.push('matches bulk export intent');
    return { classification: 'sensitive', reasons, category: 'bulk_export' };
  }

  return { classification: 'safe', reasons: [], category: 'general' };
}
