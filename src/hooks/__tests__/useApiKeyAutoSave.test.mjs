// src/hooks/__tests__/useApiKeyAutoSave.test.mjs
//
// Greptile: unmount flush through runSave; trailing edits while in-flight must queue.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../useApiKeyAutoSave.ts');

describe('useApiKeyAutoSave Greptile', () => {
  test('unmount cleanup calls runSave, not onSaveRef.current directly', () => {
    const src = fs.readFileSync(SRC, 'utf8');

    assert.match(
      src,
      /pendingRef\.current[\s\S]*?runSave\(\)/,
      'unmount flush must call runSave()',
    );

    const unmountBlock = src.slice(src.indexOf('// Flush a pending debounce on unmount'));
    assert.ok(unmountBlock.length > 0, 'unmount comment marker present');
    assert.equal(
      /onSaveRef\.current\(\)/.test(unmountBlock.split('const onBlur')[0]),
      false,
      'unmount path must not call onSaveRef.current() directly',
    );
  });

  test('in-flight saves queue a trailing pass instead of dropping the latest value', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    assert.match(src, /queuedRef/, 'must track a trailing-edge queue flag');
    assert.match(
      src,
      /if \(inFlightRef\.current\) \{[\s\S]*?queuedRef\.current = true/,
      'in-flight runSave must set queuedRef instead of returning silently',
    );
    assert.match(
      src,
      /if \(queuedRef\.current\) \{[\s\S]*?queuedRef\.current = false;[\s\S]*?runSave\(\)/,
      'finally must drain queuedRef via runSave()',
    );
  });

  test('dedupes identical values so enabled toggles do not re-fire the same key', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    assert.match(src, /lastAttemptedRef/, 'must track last attempted value');
    assert.match(
      src,
      /if \(lastAttemptedRef\.current === v\) return/,
      'runSave must skip when value was already attempted',
    );
    assert.match(
      src,
      /if \(lastAttemptedRef\.current === value\)/,
      'debounce effect must skip when value was already attempted',
    );
  });
});
