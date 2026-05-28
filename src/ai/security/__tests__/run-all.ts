/**
 * Run every AI-security test phase in sequence and report aggregate results.
 *
 * Usage:  npx tsx src/ai/security/__tests__/run-all.ts
 *
 * Each phase file is self-contained and prints its own summary; this
 * script just orchestrates them so we have a single command for regression.
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const phases = [
  { id: 1, file: 'phase1.test.ts' },
  { id: 2, file: 'phase2.test.ts' },
  { id: 3, file: 'phase3.test.ts' },
  { id: 4, file: 'phase4.test.ts' },
];

let totalPassed = 0;
let totalFailed = 0;
const failingPhases: number[] = [];

for (const { id, file } of phases) {
  console.log(`\n══════════ Phase ${id} ══════════`);
  const result = spawnSync('npx', ['tsx', resolve(here, file)], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failingPhases.push(id);
    totalFailed++;
  } else {
    totalPassed++;
  }
}

console.log(
  `\n══════════ Summary ══════════\n` +
  `Phases passed: ${totalPassed}/${phases.length}\n` +
  (failingPhases.length > 0 ? `Failing phases: ${failingPhases.join(', ')}\n` : ''),
);

process.exit(failingPhases.length === 0 ? 0 : 1);
