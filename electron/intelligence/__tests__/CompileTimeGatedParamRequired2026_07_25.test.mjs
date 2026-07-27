// electron/intelligence/__tests__/CompileTimeGatedParamRequired2026_07_25.test.mjs
//
// Phase 6 Slice 4 (context-rebuild): "A new test asserting
// getKnowledgeOrchestrator()'s new signature is a compile-time error for
// any call site that omits the CanonicalTurn parameter — a tsc-level test
// ..., not a runtime test."
//
// This session's Slice 4 work did NOT change `getKnowledgeOrchestrator()`'s
// own signature (see 05_MIGRATION_PLAN.md's Slice 4 STATUS note — that
// would force all 19 existing call sites to migrate at once). Instead it
// added a NEW, additive gated entry point,
// `electron/intelligence/knowledgeOrchestratorGate.ts`'s
// `processQuestionGated(orchestrator, question, allowed)`, whose third
// parameter is REQUIRED (no `?`, no default) — a call site that omits it
// cannot compile. This test proves that concretely: a fixture file that
// deliberately omits the third argument is compiled with a real,
// isolated `tsc --noEmit` invocation and asserted to fail with the expected
// diagnostic — not a source-text guess about what TypeScript would do.
//
// The fixture lives at fixtures/processQuestionGatedMissingParam.ts.fixture
// (NOT `.ts`) so electron/tsconfig.json's `**/*.ts` include glob never picks
// it up and it never breaks `npm run typecheck:electron`. This test copies
// it to a real `.ts` file INSIDE the same fixtures directory (preserving
// its relative import path to knowledgeOrchestratorGate.ts) immediately
// before invoking tsc, and deletes it in a `finally`/`after` block so a
// crash mid-test can never leave a stray `.ts` file for the main typecheck
// to trip over.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const fixturesDir = path.resolve(__dirname, 'fixtures');
const fixtureSrc = path.join(fixturesDir, 'processQuestionGatedMissingParam.ts.fixture');
const tempTsFile = path.join(fixturesDir, '__temp_compile_fixture_slice4_2026_07_25.ts');

function cleanup() {
  try { fs.unlinkSync(tempTsFile); } catch { /* already gone */ }
}

describe('processQuestionGated\'s third parameter is a REAL compile-time requirement', () => {
  after(cleanup);

  test('a call site that omits the `allowed` parameter fails tsc --noEmit with the expected diagnostic', () => {
    cleanup(); // in case a prior crashed run left it behind
    fs.copyFileSync(fixtureSrc, tempTsFile);
    try {
      let stdout = '';
      let threw = false;
      try {
        stdout = execFileSync(
          'node_modules/.bin/tsc',
          ['--noEmit', '--strict', 'false', '--esModuleInterop', '--skipLibCheck',
            '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'ESNext',
            '--jsx', 'react-jsx', tempTsFile],
          { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' },
        );
      } catch (err) {
        threw = true;
        stdout = (err.stdout || '') + (err.stderr || '');
      }
      assert.ok(threw, 'tsc must exit non-zero — the fixture is deliberately invalid');
      assert.match(
        stdout,
        /Expected 3 arguments, but got 2|error TS2554/,
        `expected a "missing argument" diagnostic (TS2554), got:\n${stdout}`,
      );
    } finally {
      cleanup();
    }
  });
});
