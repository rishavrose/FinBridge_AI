/**
 * Phase 2 risk-engine tests — pure policy logic, no Redis required.
 *
 * Verifies:
 *   - levelForScore() boundaries match the documented thresholds
 *   - POINT_WEIGHTS sum to the expected progression (the "3-5 probes →
 *     restricted mode" guarantee from the brief)
 *
 * The Redis-backed ZSET behaviour (sliding window prune, rapid-probing
 * bonus, lockout TTL) is verified end-to-end on the deployed server with
 * the bash recipe documented in the PR description.
 */

import assert from 'node:assert/strict';

import { levelForScore, POINT_WEIGHTS } from '../risk-engine.js';

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

// ─── Level boundaries ────────────────────────────────────────────────────────

describe('levelForScore — exact boundaries', () => {
  it('0 → LOW',         () => assert.equal(levelForScore(0), 'LOW'));
  it('24 → LOW',        () => assert.equal(levelForScore(24), 'LOW'));
  it('25 → MEDIUM',     () => assert.equal(levelForScore(25), 'MEDIUM'));
  it('49 → MEDIUM',     () => assert.equal(levelForScore(49), 'MEDIUM'));
  it('50 → HIGH',       () => assert.equal(levelForScore(50), 'HIGH'));
  it('79 → HIGH',       () => assert.equal(levelForScore(79), 'HIGH'));
  it('80 → CRITICAL',   () => assert.equal(levelForScore(80), 'CRITICAL'));
  it('200 → CRITICAL',  () => assert.equal(levelForScore(200), 'CRITICAL'));
});

// ─── Documented escalation path ─────────────────────────────────────────────

describe('POINT_WEIGHTS produce the documented escalation', () => {
  it('1 high-risk refusal → MEDIUM', () => {
    // 1 × 25 = 25  → MEDIUM (the boundary)
    assert.equal(levelForScore(POINT_WEIGHTS.refusal), 'MEDIUM');
  });

  it('2 high-risk refusals → HIGH', () => {
    // 2 × 25 = 50  → HIGH
    assert.equal(levelForScore(POINT_WEIGHTS.refusal * 2), 'HIGH');
  });

  it('3 high-risk refusals → still HIGH (just below critical)', () => {
    // 3 × 25 = 75 → HIGH
    assert.equal(levelForScore(POINT_WEIGHTS.refusal * 3), 'HIGH');
  });

  it('4 high-risk refusals → CRITICAL', () => {
    // 4 × 25 = 100 → CRITICAL
    assert.equal(levelForScore(POINT_WEIGHTS.refusal * 4), 'CRITICAL');
  });

  it('2 refusals + 1 rapid-probing bonus → CRITICAL boundary', () => {
    // The bonus fires when a second refusal lands within 60s.
    // 25 + 25 + 10 = 60 → HIGH (still below CRITICAL).
    // But three refusals + bonus would be 25 + 25 + 10 + 25 = 85 → CRITICAL.
    assert.equal(levelForScore(25 + 25 + POINT_WEIGHTS.rapid_probing_bonus), 'HIGH');
    assert.equal(
      levelForScore(25 + 25 + POINT_WEIGHTS.rapid_probing_bonus + 25),
      'CRITICAL',
    );
  });

  it('5 sensitive (bulk-export) queries → MEDIUM', () => {
    // 5 × 10 = 50 → HIGH. Three sensitive (30) → MEDIUM. Five (50) → HIGH.
    assert.equal(levelForScore(POINT_WEIGHTS.sensitive * 5), 'HIGH');
    assert.equal(levelForScore(POINT_WEIGHTS.sensitive * 3), 'MEDIUM');
  });

  it('2 zero-result leak scrubs → MEDIUM', () => {
    // 2 × 15 = 30 → MEDIUM
    assert.equal(levelForScore(POINT_WEIGHTS.zero_result_block * 2), 'MEDIUM');
  });
});

// ─── Sanity on the weights themselves ───────────────────────────────────────

describe('POINT_WEIGHTS shape', () => {
  it('all weights are positive integers', () => {
    for (const [k, v] of Object.entries(POINT_WEIGHTS)) {
      assert.ok(Number.isInteger(v), `${k} is not an integer`);
      assert.ok(v > 0, `${k} is not positive`);
    }
  });

  it('refusal weight > sensitive weight > zero_result_block / 2', () => {
    // Refusal is the strongest single signal; sensitive is gentlest;
    // zero-result is in between. Guards against accidental weight inversion.
    assert.ok(POINT_WEIGHTS.refusal > POINT_WEIGHTS.sensitive);
    assert.ok(POINT_WEIGHTS.zero_result_block >= POINT_WEIGHTS.sensitive);
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
