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
    | 'out_of_domain'
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
  // "top 10 merchants", "biggest users", "largest accounts" — identity enumeration
  /\b(top|biggest|largest|highest)\s+\d*\s*(merchant|user|account|customer|payer|payee|sender|receiver|recipient|client)s?\b/i,
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
 * Out-of-domain queries: e-commerce, logistics, entertainment, general
 * knowledge, travel, recipes, social media — anything that is clearly NOT
 * fintech/payment related.
 *
 * Keep these HIGH-CONFIDENCE only. Patterns must not fire on legitimate
 * fintech questions. Use negative lookahead for terms that dual-appear in
 * payment context (e.g. "Amazon Pay", "Swiggy payment").
 */
const OUT_OF_DOMAIN_PATTERNS: RegExp[] = [
  // E-commerce platforms (only when NOT followed by pay/payment/gateway)
  /\b(shopify|flipkart|meesho|myntra|snapdeal|nykaa|bigcommerce|woocommerce|magento)\b/i,
  /\b(online\s+store|ecommerce\s+platform|shopping\s+(website|portal|app|cart))\b/i,

  // Logistics / courier / delivery companies (non-payment context)
  /\b(delhivery|bluedart|dtdc|shadowfax|xpressbees|ecomexpress|shiprocket)\b/i,
  /\b(logistics\s+(company|companies|firm|provider|partner|industry))\b/i,
  /\b(courier\s+(service|company|partner|rates?))\b/i,

  // Entertainment — movies, cricket scores, music
  /\b(movie\s+review|film\s+recommend|bollywood\s+(movie|actor|actress)|netflix\s+show|web\s+series\s+recommend)\b/i,
  /\b(ipl\s+(score|match|result|team|player)|cricket\s+(score|result|match|highlights))\b/i,
  /\b(song\s+recommend|playlist|album\s+release|music\s+artist)\b/i,

  // Recipes / food (not food-delivery payment)
  /\b(recipe\s+for|how\s+to\s+(cook|make|prepare|bake)\s+(?!payment|report|invoice))\b/i,
  /\b(ingredients\s+(for|of)|cooking\s+(time|method|tips))\b/i,

  // Travel bookings (not payment/refund related)
  /\b(hotel\s+booking|flight\s+(booking|search|deal)|train\s+ticket\s+(booking|price)|tour\s+package|holiday\s+package|travel\s+itinerary)\b/i,
  /\b(best\s+(hotel|resort|destination|tourist\s+place)\s+in)\b/i,

  // Medical / health advice
  /\b(medicine\s+for|dosage\s+of|symptoms\s+of|treatment\s+for|home\s+remedy\s+for)\b/i,
  /\b(which\s+doctor|which\s+hospital|medical\s+advice|health\s+tips)\b/i,

  // Social media strategies / digital marketing
  /\b(social\s+media\s+(marketing|strategy|campaign|post|follower)|seo\s+(strategy|tips|tools)|content\s+marketing|digital\s+marketing\s+(strategy|agency))\b/i,

  // Generic general-knowledge questions
  /\b(capital\s+of\s+[a-z]+|what\s+is\s+the\s+(population|area)\s+of|who\s+(is|was)\s+the\s+(prime\s+minister|president|king|ceo\s+of(?!\s+(payment|bank|fintech))))\b/i,
  /\b(history\s+of\s+(?!payment|upi|banking|fintech)|origin\s+of\s+(?!payment|upi|banking)|biography\s+of)\b/i,
  /\b(when\s+was\s+.{1,30}\s+(born|invented|discovered|founded)\b)/i,

  // Weather
  /\b(weather\s+(in|for|today|tomorrow|forecast)|temperature\s+in\s+[a-z]+|will\s+it\s+rain)\b/i,

  // Hinglish / Hindi out-of-domain
  /\b(kon\s+si\s+(website|company|app|brand)|kaun\s+si\s+(website|company|app|brand))\b/i,
  /\b(kaise\s+(banaye|banta|milta|milti|hota|hoti))\b/i,
  /\b(logistics\s+ki\s+company|delivery\s+ki\s+company|ecommerce\s+ki\s+website)\b/i,
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

  // Out-of-domain check runs first — no point scoring security risk on a
  // query that's simply about cooking or cricket.
  if (matchAny(message, OUT_OF_DOMAIN_PATTERNS)) {
    reasons.push('query is outside fintech/payment domain');
    return { classification: 'high_risk', reasons, category: 'out_of_domain' };
  }

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
