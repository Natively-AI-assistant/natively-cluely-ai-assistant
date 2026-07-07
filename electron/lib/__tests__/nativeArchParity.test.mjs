/**
 * PARITY TEST — guards against drift between the ESM and CJS implementations
 * of nativeArch. The two files MUST stay byte-equivalent in behavior:
 *
 *   electron/lib/nativeArch.mjs  — used by async/ESM callers
 *                                  (verify-native-arch.js, the boot gate's
 *                                  parent module)
 *   electron/lib/nativeArch.cjs  — used by sync CJS callers
 *                                  (rebuild-native-electron.js, the boot
 *                                  gate's IIFE which fires before __esm
 *                                  initializers)
 *
 * Drift here re-introduces the bug the shared module exists to prevent.
 * If you change one, change the other and update the tests below.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('nativeArch parity (cjs ↔ esm)', () => {
  test('both modules expose the same surface', () => {
    const cjs = require('../nativeArch.cjs');
    // Dynamic import for the ESM module
    return import('../nativeArch.mjs').then((esm) => {
      const cjsKeys = Object.keys(cjs).sort();
      const esmKeys = Object.keys(esm).sort();
      assert.deepEqual(
        esmKeys,
        cjsKeys,
        `Surface mismatch — ESM exports ${JSON.stringify(esmKeys)} but CJS exports ${JSON.stringify(cjsKeys)}. Update both files together.`,
      );
    });
  });

  test('detectHardwareArch returns the same value from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const c = cjs.detectHardwareArch();
      const e = esm.detectHardwareArch();
      assert.equal(c, e, `cjs.detectHardwareArch=${c} esm.detectHardwareArch=${e}`);
    });
  });

  test('TARGETS is byte-equal between cjs and esm', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      assert.deepEqual([...esm.TARGETS], [...cjs.TARGETS]);
    });
  });

  test('buildFixCommand returns the same value from both modules', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      assert.equal(cjs.buildFixCommand(), esm.buildFixCommand());
    });
  });

  test('binaryArch produces the same result for the same file', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      // Use the actually-installed better-sqlite3 binary if available.
      // If not present (CI without native modules), skip — parity is still
      // validated by the other tests in this file.
      const realPath = require('node:path').resolve(
        process.cwd(),
        'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      );
      const exists = require('node:fs').existsSync(realPath);
      if (!exists) return;
      assert.equal(cjs.binaryArch(realPath), esm.binaryArch(realPath));
    });
  });

  test('verifyAll produces equivalent results for an explicit repoRoot', () => {
    const cjs = require('../nativeArch.cjs');
    return import('../nativeArch.mjs').then((esm) => {
      const cResult = cjs.verifyAll(process.cwd());
      const eResult = esm.verifyAll(process.cwd());
      assert.equal(cResult.ok, eResult.ok, 'ok mismatch');
      assert.equal(cResult.skipped, eResult.skipped, 'skipped mismatch');
      assert.equal(cResult.hardware, eResult.hardware, 'hardware mismatch');
      assert.deepEqual(cResult.mismatches, eResult.mismatches, 'mismatches mismatch');
      assert.equal(cResult.fix, eResult.fix, 'fix mismatch');
    });
  });
});