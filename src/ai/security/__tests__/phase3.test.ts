/**
 * Phase 3 tests — response guard, cache safety, trace redactor.
 *
 * All three modules are pure functions, so we test them without any DB
 * or Redis. Run via `npx tsx src/ai/security/__tests__/phase3.test.ts`.
 */

import assert from 'node:assert/strict';

import { guardResponse, UNVERIFIED_DATA_FALLBACK } from '../response-guard.js';
import { isCacheable } from '../cache-safety.js';
import {
  redactToolCallsTrace,
  shouldRedactTrace,
} from '../trace-redactor.js';
import type { ValidationResult } from '../../validation/hallucination-validator.js';

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

// ─── Response guard ──────────────────────────────────────────────────────────

const ungrounded = (
  kind: 'currency' | 'id' | 'number' | 'date',
  value: string,
): ValidationResult => ({
  grounded: false,
  checked: 1,
  unsupported: [{ kind, value }],
  reason: 'test',
});

describe('guardResponse', () => {
  it('passes through when validation is missing', () => {
    const out = guardResponse({ reply: 'Failed Payouts: 47', validation: undefined });
    assert.equal(out.blocked, false);
    assert.equal(out.reply, 'Failed Payouts: 47');
  });

  it('passes through when validation is grounded', () => {
    const out = guardResponse({
      reply: 'Failed Payouts: 47',
      validation: { grounded: true, checked: 1, unsupported: [], reason: 'ok' },
    });
    assert.equal(out.blocked, false);
  });

  it('blocks on unsupported currency', () => {
    const out = guardResponse({
      reply: 'Total: ₹12,50,000.50',
      validation: ungrounded('currency', '₹12,50,000.50'),
    });
    assert.equal(out.blocked, true);
    assert.equal(out.reply, UNVERIFIED_DATA_FALLBACK);
    assert.match(out.reason ?? '', /currency/);
  });

  it('blocks on unsupported IDs', () => {
    const out = guardResponse({
      reply: 'Payout PAYOUT-184729 is pending.',
      validation: ungrounded('id', 'PAYOUT-184729'),
    });
    assert.equal(out.blocked, true);
    assert.match(out.reason ?? '', /ID/);
  });

  it('blocks 2+ unsupported numbers in financial reply', () => {
    const out = guardResponse({
      reply: 'Today payout count: 329, total amount: 128500',
      validation: {
        grounded: false,
        checked: 2,
        unsupported: [
          { kind: 'number', value: '329' },
          { kind: 'number', value: '128500' },
        ],
        reason: 'multiple unsupported',
      },
    });
    assert.equal(out.blocked, true);
  });

  it('does NOT block single unsupported number (too noisy)', () => {
    const out = guardResponse({
      reply: 'I see 47 things.',
      validation: ungrounded('number', '47'),
    });
    assert.equal(out.blocked, false);
  });

  it('does NOT block 2 unsupported numbers if reply is non-financial', () => {
    const out = guardResponse({
      reply: 'I noticed 47 things and 88 other things.',
      validation: {
        grounded: false,
        checked: 2,
        unsupported: [
          { kind: 'number', value: '47' },
          { kind: 'number', value: '88' },
        ],
        reason: 'multi',
      },
    });
    assert.equal(out.blocked, false);
  });
});

// ─── Cache safety ────────────────────────────────────────────────────────────

describe('isCacheable — prompt disqualifiers', () => {
  const badPrompts: string[] = [
    'why did payout PAYOUT-184729 fail',
    'show me UTR 20230598471234',
    'lookup account number 1234567890',
    'merchant id 9988',
    'merchant Acme Corp balance',
    'transactions for 9876543210',
    'profile for user john.doe@example.com',
  ];

  for (const p of badPrompts) {
    it(`refuses to cache prompt "${p}"`, () => {
      const out = isCacheable(p, 'some response');
      assert.equal(out.cacheable, false, `expected non-cacheable: ${out.reason}`);
      assert.equal(out.source, 'prompt');
    });
  }
});

describe('isCacheable — reply disqualifiers', () => {
  it('refuses when reply names a payout ID', () => {
    const out = isCacheable('show recent failures', 'The latest is PAYOUT-184729');
    assert.equal(out.cacheable, false);
    assert.equal(out.source, 'reply');
  });

  it('refuses when reply contains IFSC', () => {
    const out = isCacheable('show recent', 'Routed via HDFC0001234');
    assert.equal(out.cacheable, false);
    assert.equal(out.source, 'reply');
  });

  it('refuses when reply contains an 8+ digit number', () => {
    const out = isCacheable('show recent', 'RRN is 20230598471234');
    assert.equal(out.cacheable, false);
  });
});

describe('isCacheable — generic queries pass', () => {
  const goodCases: Array<[string, string]> = [
    ["today's failed payouts", 'Failed Payouts: 47'],
    ['current TPS',            'Live TPS: 12.5'],
    ['success rate this hour', 'Success Rate: 98.4%'],
    ['failure reasons',        'Top reason: bank timeout (62%)'],
  ];

  for (const [p, r] of goodCases) {
    it(`allows: "${p}" → "${r}"`, () => {
      const out = isCacheable(p, r);
      assert.equal(out.cacheable, true, `expected cacheable: ${out.reason}`);
    });
  }
});

// ─── Trace redactor ──────────────────────────────────────────────────────────

const sampleTrace = [
  {
    name: 'query_securenxt_tbl_payouts',
    args: { filters: { status: 1 }, limit: 10 },
    sql: 'SELECT * FROM `tbl_payouts` WHERE status = ?',
    params: [1],
  },
];

describe('shouldRedactTrace', () => {
  it('admin → no redaction', () => {
    assert.equal(shouldRedactTrace('admin'), false);
  });
  it('analyst → redact', () => {
    assert.equal(shouldRedactTrace('analyst'), true);
  });
  it('readonly → redact', () => {
    assert.equal(shouldRedactTrace('readonly'), true);
  });
  it('service → redact', () => {
    assert.equal(shouldRedactTrace('service'), true);
  });
});

describe('redactToolCallsTrace', () => {
  it('returns trace unchanged for admin', () => {
    const out = redactToolCallsTrace(sampleTrace, 'admin');
    assert.deepEqual(out, sampleTrace);
  });

  it('strips sql/params/args for non-admin', () => {
    const out = redactToolCallsTrace(sampleTrace, 'analyst');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'query_securenxt_tbl_payouts');
    assert.deepEqual(out[0].args, {});
    assert.equal((out[0] as { sql?: string }).sql, undefined);
    assert.equal((out[0] as { params?: unknown[] }).params, undefined);
  });

  it('returns the SAME array reference when admin (cheap path)', () => {
    const out = redactToolCallsTrace(sampleTrace, 'admin');
    assert.equal(out, sampleTrace);
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
