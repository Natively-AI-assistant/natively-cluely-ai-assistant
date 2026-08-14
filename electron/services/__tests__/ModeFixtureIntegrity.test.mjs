// electron/services/__tests__/ModeFixtureIntegrity.test.mjs
//
// Smoke test for the fixture data itself: every sentinel declared in
// referenceFileFactory.mjs must actually appear (verbatim) in at least one
// reference file under tests/fixtures/modes/<mode>/. This prevents the
// scenario tests from passing-by-accident if a fixture is renamed or its
// content is rewritten in a way that drops the sentinel.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SENTINELS, loadReferenceFiles } from '../../../tests/utils/referenceFileFactory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_ROOT = path.resolve(__dirname, '../../../tests/fixtures/modes');

describe('Fixture integrity — every declared sentinel exists in at least one fixture file', () => {
  for (const [mode, sentinels] of Object.entries(SENTINELS)) {
    test(`mode "${mode}": all sentinels are present in fixtures/modes/${mode}/`, () => {
      const files = loadReferenceFiles(mode);
      const combined = files.map(f => f.content).join('\n');
      for (const [name, phrase] of Object.entries(sentinels)) {
        assert.ok(
          combined.includes(phrase),
          `Mode "${mode}": sentinel "${name}" (phrase: "${phrase}") not found in any fixture file.\n` +
            `Files present: ${files.map(f => f.fileName).join(', ')}`
        );
      }
    });
  }

  // The `custom/` directory is a meta-folder containing per-custom-mode
  // subfolders; it is exercised by CustomModes.test.mjs and is not itself a
  // mode folder. Skip it here.
  const isCoreMode = (name) => name !== 'custom';

  test('every mode folder has 5 reference files', () => {
    for (const modeDir of fs.readdirSync(FIX_ROOT)) {
      if (!isCoreMode(modeDir)) continue;
      const files = fs.readdirSync(path.join(FIX_ROOT, modeDir)).filter(n => !n.startsWith('.'));
      assert.equal(
        files.length,
        5,
        `Mode "${modeDir}" should have exactly 5 reference files (got ${files.length}: ${files.join(', ')})`
      );
    }
  });

  test('every mode folder covers at least 4 distinct file extensions', () => {
    for (const modeDir of fs.readdirSync(FIX_ROOT)) {
      if (!isCoreMode(modeDir)) continue;
      const files = fs.readdirSync(path.join(FIX_ROOT, modeDir)).filter(n => !n.startsWith('.'));
      const exts = new Set(files.map(f => path.extname(f).toLowerCase()));
      assert.ok(
        exts.size >= 4,
        `Mode "${modeDir}" must cover ≥4 extensions for format coverage (got ${exts.size}: ${[...exts].join(', ')})`
      );
    }
  });

  test('every custom-mode folder has at least 5 reference files with ≥4 distinct extensions', () => {
    const customRoot = path.join(FIX_ROOT, 'custom');
    if (!fs.existsSync(customRoot)) return;
    for (const customMode of fs.readdirSync(customRoot)) {
      const files = fs.readdirSync(path.join(customRoot, customMode)).filter(n => !n.startsWith('.'));
      // Was `=== 5`; relaxed to `>= 5` (2026-07-01) — the OKF work
      // intentionally added a real PDF (`seminar_real_thesis.pdf`) to the
      // seminar-presentation fixture for the real-PDF ingestion tests, so
      // the fixture legitimately grew past 5. The test's actual intent is a
      // representative MULTI-file fixture with broad format coverage, not an
      // exact count; a hardcoded 5 just made every intentional fixture
      // addition a spurious failure.
      assert.ok(
        files.length >= 5,
        `Custom mode "${customMode}" should have at least 5 reference files (got ${files.length}: ${files.join(', ')})`,
      );
      const exts = new Set(files.map(f => path.extname(f).toLowerCase()));
      assert.ok(
        exts.size >= 4,
        `Custom mode "${customMode}" must cover ≥4 extensions (got ${exts.size}: ${[...exts].join(', ')})`,
      );
    }
  });
});
