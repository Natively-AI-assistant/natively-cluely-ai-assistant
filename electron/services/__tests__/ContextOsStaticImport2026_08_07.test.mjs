// electron/services/__tests__/ContextOsStaticImport2026_08_07.test.mjs
//
// PR #427 §3.3: "Dynamic require() in the hot answer path".
//
// IntelligenceEngine reached Context OS through 10 synchronous
// `require('./intelligence/context-os')` calls inside runWhatShouldISay and the
// follow-up/recap paths. They bypass the TypeScript module graph, defeat
// tree-shaking, and each one re-does a module lookup on every answer.
//
// Verified before changing anything:
//   - context-os does NOT import IntelligenceEngine (no dependency cycle), so
//     the dynamic form was never required to break a cycle;
//   - the `catch { return true; }` fail-open at the profile-repair gate is
//     defence-in-depth, not a live leak: candidateProfile is already cleared
//     upstream when the contract denies profile, so `profileLoaded` is false
//     and the gate cannot re-open a denied source. The conversion therefore
//     preserves behaviour exactly and is purely mechanical.
//
// This suite pins the outcome so the dynamic form cannot creep back, and
// re-asserts the security property that made the conversion safe.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(here, '../../IntelligenceEngine.ts');
const source = fs.readFileSync(ENGINE, 'utf8');

describe('Context OS is reached via static imports, not hot-path require()', () => {
  test('no dynamic require of context-os remains in IntelligenceEngine', () => {
    const matches = source.match(/require\(\s*['"]\.\/intelligence\/context-os['"]\s*\)/g) || [];
    assert.equal(matches.length, 0, `${matches.length} dynamic require(context-os) call(s) still present`);
  });

  test('context-os is imported statically at module scope', () => {
    // A namespace import is used deliberately: three call sites bound the whole
    // module (`const contextOs = require(...)`), so importing the namespace once
    // lets every site keep its exact local binding names — the smallest diff and
    // no downstream reference churn.
    assert.match(
      source,
      /import \* as contextOsStatic from ['"]\.\/intelligence\/context-os['"]/,
      'expected a static namespace import of ./intelligence/context-os',
    );
  });

  test('every symbol previously pulled dynamically is still available', () => {
    // The union of what the 10 dynamic sites destructured.
    for (const symbol of [
      'allowsEvidence',
      'buildTurnContractIfEnabled',
      'buildContextOsTrace',
      'logContextOsTrace',
      'buildSourceClarification',
      'TurnEvidenceCoordinator',
      'ProfileEvidenceService',
    ]) {
      assert.ok(
        new RegExp(`\\b${symbol}\\b`).test(source),
        `${symbol} is no longer referenced — a dynamic site was dropped rather than converted`,
      );
    }
  });
});

describe('the fail-open profile-repair gate stays defended upstream', () => {
  test('candidateProfile is still cleared when the contract denies profile', () => {
    // This is WHY the `catch { return true; }` fail-open is safe. If these
    // clears ever disappear, the fail-open becomes a real profile leak and this
    // test must fail loudly rather than let it pass silently.
    const clears = source.match(/^\s*candidateProfile\s*=\s*''\s*;/gm) || [];
    assert.ok(clears.length >= 2, `expected the contract-denial clears to remain, found ${clears.length}`);
  });
});
