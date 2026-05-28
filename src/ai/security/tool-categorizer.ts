/**
 * Tool-name categorizer.
 *
 * Internal tool names like `query_securenxt_tbl_payouts` are useful for
 * admins debugging but leak our data model (table prefixes, table names,
 * connection names) to non-admin users. This module maps each tool name
 * to a stable, business-language category label.
 *
 * Mapping table is intentionally small and conservative — anything we
 * don't explicitly recognize falls back to `data_query`. We DO NOT try
 * to infer categories from arbitrary tool names, because a wrong guess
 * would mean leaking a label that's still too descriptive.
 */

/** Pattern matchers — order matters; first hit wins. */
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  // Dynamic tools generated from connected tenant DBs.
  { pattern: /tbl_payouts\b|^query_.*payouts?$/i,            category: 'payout_query' },
  { pattern: /tbl_bank_lists\b|^query_.*bank/i,              category: 'bank_query' },
  { pattern: /tbl_settlements?\b|^query_.*settlement/i,      category: 'settlement_query' },
  { pattern: /tbl_users?\b|^query_.*user/i,                  category: 'user_query' },
  { pattern: /tbl_merchants?\b|^query_.*merchant/i,          category: 'merchant_query' },
  { pattern: /tbl_transactions?\b|^query_.*transaction/i,    category: 'transaction_query' },
  { pattern: /tbl_chargebacks?\b/i,                          category: 'chargeback_query' },

  // Static fintech tools.
  { pattern: /^get_bank_health$/i,                           category: 'bank_health' },
  { pattern: /^get_recent_transactions$/i,                   category: 'transaction_query' },
  { pattern: /^get_failed_payouts$/i,                        category: 'payout_query' },
  { pattern: /^get_user_balance$/i,                          category: 'balance_query' },
  { pattern: /^get_settlement_report$/i,                     category: 'settlement_query' },
  { pattern: /^search_rrn$/i,                                category: 'transaction_query' },
];

const DEFAULT_CATEGORY = 'data_query';

export function toolCategory(toolName: string): string {
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(toolName)) return category;
  }
  return DEFAULT_CATEGORY;
}
