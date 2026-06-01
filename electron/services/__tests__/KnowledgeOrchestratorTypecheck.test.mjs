// electron/services/__tests__/KnowledgeOrchestratorTypecheck.test.mjs
// Regression guard for the "method called but never defined" class of bug
// (e.g. processQuestion calling this.buildCompactIdentityBlock() with no
// definition). The other intelligence tests use inline replicas of the logic
// because the real KnowledgeOrchestrator can't load in the node test runner
// (native better-sqlite3 is an esbuild external), so they cannot catch a
// missing method on the real class. esbuild also transpiles without type
// checking, so `build:electron` won't catch it either.
//
// This test runs `tsc --noEmit` and asserts there are ZERO TS2339
// ("Property X does not exist") errors in KnowledgeOrchestrator.ts. It tolerates
// the repo's pre-existing unrelated TS errors in other files.
// Run: node --test electron/services/__tests__/KnowledgeOrchestratorTypecheck.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('KnowledgeOrchestrator.ts has no TS2339 "property does not exist" errors', () => {
  let out = '';
  try {
    // execFileSync with an arg array — no shell, no injection surface. The
    // command and args are all hardcoded constants regardless.
    execFileSync('npx', ['tsc', '-p', 'electron/tsconfig.json', '--noEmit'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // tsc exits non-zero when ANY error exists (including unrelated pre-existing
    // ones). Capture its stdout and filter to the file + error class we care about.
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }

  const offending = out
    .split('\n')
    .filter(line => line.includes('premium/electron/knowledge/KnowledgeOrchestrator.ts') && line.includes('error TS2339'));

  assert.strictEqual(
    offending.length,
    0,
    `KnowledgeOrchestrator.ts calls a method/property that isn't defined:\n${offending.join('\n')}`
  );
});
