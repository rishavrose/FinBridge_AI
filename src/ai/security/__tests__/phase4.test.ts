/**
 * Phase 4 tests — role visibility tiers, tool categorizer, 3-tier trace
 * redaction. Pure functions, no IO.
 *
 * Run via `npx tsx src/ai/security/__tests__/phase4.test.ts`.
 */

import assert from 'node:assert/strict';

import {
  getVisibilityTier,
  isFullVisibility,
  showsRealToolNames,
  showsSqlAndParams,
  showsToolArgs,
} from '../role-policy.js';
import { toolCategory } from '../tool-categorizer.js';
import { redactToolCallsTrace, shouldRedactTrace } from '../trace-redactor.js';

type TestFn = () => void;
const failures: string[] = [];
let passed = 0;
const hasJest = typeof (globalThis as { it?: unknown }).it === 'function';

function describe(name: string, body: () => void) {
  if (hasJest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).describe(name, body);
    return;
  }
  console.log('\n• ' + name);
  body();
}

function it(name: string, body: TestFn) {
  if (hasJest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).it(name, body);
    return;
  }
  try {
    body();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log('  ✗ ' + name + '  ' + (err as Error).message);
  }
}

// ─── Role policy ─────────────────────────────────────────────────────────────

describe('getVisibilityTier — role → tier mapping', () => {
  it('admin    → full',     () => assert.equal(getVisibilityTier('admin'),    'full'));
  it('service  → business', () => assert.equal(getVisibilityTier('service'),  'business'));
  it('analyst  → redacted', () => assert.equal(getVisibilityTier('analyst'),  'redacted'));
  it('readonly → redacted', () => assert.equal(getVisibilityTier('readonly'), 'redacted'));
});

describe('predicates derived from tier', () => {
  it('isFullVisibility: only admin', () => {
    assert.equal(isFullVisibility('admin'),    true);
    assert.equal(isFullVisibility('service'),  false);
    assert.equal(isFullVisibility('analyst'),  false);
    assert.equal(isFullVisibility('readonly'), false);
  });

  it('showsRealToolNames: admin + service only', () => {
    assert.equal(showsRealToolNames('admin'),    true);
    assert.equal(showsRealToolNames('service'),  true);
    assert.equal(showsRealToolNames('analyst'),  false);
    assert.equal(showsRealToolNames('readonly'), false);
  });

  it('showsSqlAndParams: admin only', () => {
    assert.equal(showsSqlAndParams('admin'),    true);
    assert.equal(showsSqlAndParams('service'),  false);
    assert.equal(showsSqlAndParams('analyst'),  false);
    assert.equal(showsSqlAndParams('readonly'), false);
  });

  it('showsToolArgs: admin + service only', () => {
    assert.equal(showsToolArgs('admin'),    true);
    assert.equal(showsToolArgs('service'),  true);
    assert.equal(showsToolArgs('analyst'),  false);
    assert.equal(showsToolArgs('readonly'), false);
  });
});

// ─── Tool categorizer ────────────────────────────────────────────────────────

describe('toolCategory — internal name → business label', () => {
  const cases: Array<[string, string]> = [
    ['query_securenxt_tbl_payouts',          'payout_query'],
    ['query_finbridge_tbl_bank_lists',       'bank_query'],
    ['query_securenxt_tbl_settlements',      'settlement_query'],
    ['query_finbridge_tbl_users',            'user_query'],
    ['query_finbridge_tbl_merchants',        'merchant_query'],
    ['query_finbridge_tbl_transactions',     'transaction_query'],
    ['query_finbridge_tbl_chargebacks',      'chargeback_query'],
    ['get_bank_health',                      'bank_health'],
    ['get_recent_transactions',              'transaction_query'],
    ['get_failed_payouts',                   'payout_query'],
    ['get_user_balance',                     'balance_query'],
    ['get_settlement_report',                'settlement_query'],
    ['search_rrn',                           'transaction_query'],
    ['some_unknown_internal_thing',          'data_query'], // fallback
  ];

  for (const [name, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      assert.equal(toolCategory(name), expected);
    });
  }
});

// ─── Trace redactor end-to-end ───────────────────────────────────────────────

const richTrace = [
  {
    name: 'query_securenxt_tbl_payouts',
    args: { filters: { status: 1, addeddate: '2026-05-28' }, limit: 10 },
    sql: 'SELECT * FROM `tbl_payouts` WHERE status = ? AND addeddate = ?',
    params: [1, '2026-05-28'],
  },
];

describe('redactToolCallsTrace — per tier', () => {
  it('admin → full trace (unchanged)', () => {
    const out = redactToolCallsTrace(richTrace, 'admin');
    assert.deepEqual(out, richTrace);
  });

  it('service → real name + args, NO sql/params', () => {
    const out = redactToolCallsTrace(richTrace, 'service');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'query_securenxt_tbl_payouts');
    assert.deepEqual(out[0].args, richTrace[0].args);
    assert.equal((out[0] as { sql?: string }).sql, undefined);
    assert.equal((out[0] as { params?: unknown[] }).params, undefined);
  });

  it('analyst → category label only, no args/sql/params', () => {
    const out = redactToolCallsTrace(richTrace, 'analyst');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'payout_query');
    assert.deepEqual(out[0].args, {});
    assert.equal((out[0] as { sql?: string }).sql, undefined);
    assert.equal((out[0] as { params?: unknown[] }).params, undefined);
  });

  it('readonly → category label only (same as analyst)', () => {
    const out = redactToolCallsTrace(richTrace, 'readonly');
    assert.equal(out[0].name, 'payout_query');
    assert.deepEqual(out[0].args, {});
  });
});

describe('shouldRedactTrace', () => {
  it('admin → false (no redaction)', () => assert.equal(shouldRedactTrace('admin'),    false));
  it('service → true',               () => assert.equal(shouldRedactTrace('service'),  true));
  it('analyst → true',               () => assert.equal(shouldRedactTrace('analyst'),  true));
  it('readonly → true',              () => assert.equal(shouldRedactTrace('readonly'), true));
});

// ─── Unknown internal tool names get the safe fallback ──────────────────────

describe('analyst never sees raw internal names — even for unmapped tools', () => {
  it('falls back to "data_query"', () => {
    const out = redactToolCallsTrace(
      [{ name: 'query_internal_xyz_secret_inventory', args: { whatever: 1 } }],
      'analyst',
    );
    assert.equal(out[0].name, 'data_query');
  });
});

if (!hasJest) {
  setTimeout(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      for (const f of failures) console.log('  ✗ ' + f);
      process.exit(1);
    }
  }, 30);
}
