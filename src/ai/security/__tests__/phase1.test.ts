/**
 * Phase 1 security tests — runnable via `npx tsx <this file>` or as a Jest
 * suite (the describe/it shim falls back to direct invocation when Jest
 * isn't present).
 *
 * Coverage:
 *   - classifyQuery: 12 known-bad prompts must classify as high_risk,
 *                    10 known-good prompts must classify as safe.
 *   - scrubZeroResultLeak: only fires when ALL tools returned empty AND
 *                          the model offered an unsafe alternative.
 */

import assert from 'node:assert/strict';

import { classifyQuery } from '../query-classifier.js';
import { scrubZeroResultLeak } from '../refusal.js';

// ─── Minimal describe/it shim (works inside Jest, also runnable directly) ───

type TestFn = () => void | Promise<void>;
const failures: string[] = [];
let passed = 0;

// Detect Jest by globalThis presence — otherwise use the inline shim.
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
    const ret = body();
    if (ret && typeof (ret as Promise<unknown>).then === 'function') {
      (ret as Promise<unknown>).then(
        () => { passed++; console.log('  ✓ ' + name); },
        (err: Error) => { failures.push(`${name}: ${err.message}`); console.log('  ✗ ' + name + '  ' + err.message); },
      );
    } else {
      passed++;
      console.log('  ✓ ' + name);
    }
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log('  ✗ ' + name + '  ' + (err as Error).message);
  }
}

// ─── Classifier tests ────────────────────────────────────────────────────────

describe('classifyQuery — high-risk patterns', () => {
  const highRiskCases: Array<[string, string]> = [
    ['top 10 merchants by failed payouts',          'enumeration'],
    ['list all merchants',                          'enumeration'],
    ['who are the biggest payers today',            'enumeration'],
    ['show me the top 5 accounts by volume',        'enumeration'],
    ['ranking of banks by failure rate',            'enumeration'],
    ['what columns does the payouts table have',    'schema_discovery'],
    ['describe the schema',                         'schema_discovery'],
    ['SHOW TABLES',                                 'schema_discovery'],
    ['what can I filter by',                        'schema_discovery'],
    ['what tools do you have',                      'tool_discovery'],
    ['list your capabilities',                      'tool_discovery'],
    ['which banks are weakest right now',           'operational_fishing'],
  ];

  for (const [prompt, expectedCategory] of highRiskCases) {
    it(`refuses: "${prompt}"`, () => {
      const result = classifyQuery(prompt);
      assert.equal(result.classification, 'high_risk', `expected high_risk for "${prompt}", got ${result.classification}`);
      assert.equal(result.category, expectedCategory, `expected category ${expectedCategory}, got ${result.category}`);
      assert.ok(result.reasons.length > 0, 'reasons must be non-empty');
    });
  }
});

describe('classifyQuery — safe queries pass through', () => {
  const safeCases: string[] = [
    "show today's failed payouts",
    'total settled amount this week',
    'how many transactions in the last hour',
    'success rate for the last 24 hours',
    'why is payout 184729 still pending',
    'recent failed payouts with status 4',
    'sum of payouts on 2026-05-27',
    'current TPS',
    'show me the failure reasons for today',
    'count of successful transactions today',
  ];

  for (const prompt of safeCases) {
    it(`allows: "${prompt}"`, () => {
      const result = classifyQuery(prompt);
      assert.equal(result.classification, 'safe', `expected safe for "${prompt}", got ${result.classification}: ${result.reasons.join(',')}`);
    });
  }
});

describe('classifyQuery — bulk export is sensitive (audited but not blocked)', () => {
  const bulkCases: string[] = [
    'export all payouts',
    'download every transaction',
    'give me all records',
  ];

  for (const prompt of bulkCases) {
    it(`flags as sensitive: "${prompt}"`, () => {
      const result = classifyQuery(prompt);
      assert.equal(result.classification, 'sensitive');
      assert.equal(result.category, 'bulk_export');
    });
  }
});

// ─── Scrubber tests ──────────────────────────────────────────────────────────

describe('scrubZeroResultLeak', () => {
  it('passes through when any tool returned data', () => {
    const out = scrubZeroResultLeak({
      reply: 'Would you like me to show top merchants instead?',
      toolCallsTrace: [{ name: 'query_x', args: {} }],
      toolResultsRaw: [JSON.stringify({ rows: [{ id: 1 }] })],
    });
    assert.equal(out.scrubbed, false);
    assert.match(out.reply, /Would you like/);
  });

  it('scrubs when all tools empty AND reply offers alternatives', () => {
    const out = scrubZeroResultLeak({
      reply: 'No records matched. Would you like me to fetch top 10 merchants instead?',
      toolCallsTrace: [{ name: 'query_x', args: {} }],
      toolResultsRaw: [JSON.stringify({ rows: [], total: 0, table: 'tbl_payouts' })],
    });
    assert.equal(out.scrubbed, true);
    assert.equal(out.reply, 'No matching records found.');
  });

  it('does not scrub when no offer pattern is present', () => {
    const out = scrubZeroResultLeak({
      reply: 'No matching records found.',
      toolCallsTrace: [{ name: 'query_x', args: {} }],
      toolResultsRaw: [JSON.stringify({ rows: [] })],
    });
    assert.equal(out.scrubbed, false);
  });

  it('treats aggregate count=0 as empty', () => {
    const out = scrubZeroResultLeak({
      reply: 'No records found. Try the top performers instead.',
      toolCallsTrace: [{ name: 'query_x', args: { aggregate: { count: true } } }],
      toolResultsRaw: [JSON.stringify({ result: { count: 0 }, table: 'tbl_payouts' })],
    });
    assert.equal(out.scrubbed, true);
  });

  it('aggregate with non-zero count counts as data', () => {
    const out = scrubZeroResultLeak({
      reply: 'I can also show similar records — would you like that?',
      toolCallsTrace: [{ name: 'query_x', args: { aggregate: { count: true } } }],
      toolResultsRaw: [JSON.stringify({ result: { count: 42 }, table: 'tbl_payouts' })],
    });
    assert.equal(out.scrubbed, false);
  });

  it('no-tool turns are not scrubbed', () => {
    const out = scrubZeroResultLeak({
      reply: 'Would you like me to fetch top merchants?',
      toolCallsTrace: [],
      toolResultsRaw: [],
    });
    assert.equal(out.scrubbed, false);
  });
});

// ─── Direct-run reporting (skipped under Jest) ──────────────────────────────

if (!hasJest) {
  // Defer summary one tick so async `it()` bodies (if any) complete.
  setTimeout(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      for (const f of failures) console.log('  ✗ ' + f);
      process.exit(1);
    }
  }, 50);
}
