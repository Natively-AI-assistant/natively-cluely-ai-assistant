// src/hooks/__tests__/useApiKeyAutoSave.test.mjs
//
// Greptile P2: unmount flush must route through runSave / inFlightRef, not call
// onSave directly (which races a save already in flight).
//
// Source-contract test — no React test renderer required.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../useApiKeyAutoSave.ts');

describe('useApiKeyAutoSave Greptile P2', () => {
  test('unmount cleanup calls runSave, not onSaveRef.current directly', () => {
    const src = fs.readFileSync(SRC, 'utf8');

    // The unmount effect body must invoke runSave().
    assert.match(
      src,
      /pendingRef\.current[\s\S]*?runSave\(\)/,
      'unmount flush must call runSave()',
    );

    // Must NOT directly invoke onSave from the unmount cleanup (the P2 bug).
    const unmountBlock = src.slice(src.indexOf('// Flush a pending debounce on unmount'));
    assert.ok(unmountBlock.length > 0, 'unmount comment marker present');
    assert.equal(
      /onSaveRef\.current\(\)/.test(unmountBlock.split('const onBlur')[0]),
      false,
      'unmount path must not call onSaveRef.current() directly',
    );

    // inFlight guard still lives on runSave.
    assert.match(src, /inFlightRef\.current/);
    assert.match(src, /if \(!shouldSaveRef\.current\(v\) \|\| inFlightRef\.current\) return/);
  });
});
