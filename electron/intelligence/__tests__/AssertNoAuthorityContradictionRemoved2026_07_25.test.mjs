// Phase 6 Slice 0, item 5 — assertNoAuthorityContradiction removal.
//
// docs/context-rebuild/03_ROOT_CAUSES.md (RC8) and 05_COMPONENT_DISPOSITION.md
// (§A6) found this dev-only tripwire had zero production callers, zero test
// coverage, and checked a condition (sourceOwner==='clarify' +
// finalAction==='answer') distinct from the one actually implicated in the
// investigation (RC1: finalAction hardcoded regardless of
// evidenceCoverage.confidence). Deleted from
// electron/intelligence/context-os/integration.ts and its re-export from
// electron/intelligence/context-os/index.ts.
//
// This is the negative/grep-shaped test the migration plan's Slice 0
// pre-required-tests section calls for: assert no importer remains
// repo-wide, and assert the compiled module no longer exports it.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/AssertNoAuthorityContradictionRemoved2026_07_25.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

test('no source file repo-wide imports/calls assertNoAuthorityContradiction', () => {
  // Matches actual usage syntax (an import/re-export list entry or a call),
  // not the removal note's prose mention of the identifier in
  // integration.ts's comment, and excludes this test file's own text.
  const usagePattern = 'assertNoAuthorityContradiction[,}(]';
  let output;
  try {
    output = execFileSync(
      'grep',
      ['-rlE', usagePattern, 'electron', 'src', 'premium/electron'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (err) {
    // grep exits 1 with empty stdout when no matches are found — that's the
    // expected, passing case.
    if (err.status === 1 && !err.stdout) {
      output = '';
    } else {
      throw err;
    }
  }
  const remaining = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.endsWith('AssertNoAuthorityContradictionRemoved2026_07_25.test.mjs'));
  assert.deepEqual(remaining, [], `expected zero real usages, found:\n${remaining.join('\n')}`);
});

test('compiled context-os index no longer exports assertNoAuthorityContradiction', () => {
  const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
  assert.equal(co.assertNoAuthorityContradiction, undefined);
});
