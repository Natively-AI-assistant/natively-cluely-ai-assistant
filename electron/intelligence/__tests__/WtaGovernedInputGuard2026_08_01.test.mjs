// Pattern I (deep-run 2, 2026-08-01): the What-to-Answer shortcut with no
// transcript, no screen/DOM/image capture and no typed question proceeded into
// planning, retrieval and a full provider round-trip carrying an EMPTY
// question — engine-bridge refuses empty input (`if (!question) return null`),
// so the governed V3 layer opted out and the user got a deadline-timeout
// message, a hallucinated answer to no question, or a raw internal error.
//
// The guard lives in IntelligenceEngine.runWhatShouldISay, after question
// extraction and before ANY planning/provider work. IntelligenceEngine cannot
// be constructed outside Electron, so the wiring is pinned by source
// assertion — including ORDERING, which is the load-bearing property.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..', '..');
const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

describe('WTA governed-input guard', () => {
  const guardIdx = src.indexOf('GOVERNED-INPUT CONTRACT');

  test('the guard exists and covers the full derivation chain', () => {
    assert.ok(guardIdx !== -1, 'guard block missing');
    const block = src.slice(guardIdx, guardIdx + 2400);
    assert.match(block, /!question\?\.trim\(\)/);
    assert.match(block, /!extractedQuestion\.latestQuestion/);
    assert.match(block, /!lastInterviewerTurn/);
    assert.match(block, /!preparedTranscript\.trim\(\)/);
    assert.match(block, /screenContext/);
    assert.match(block, /domContext/);
    assert.match(block, /imagePaths/);
  });

  test('speculative runs return silently; manual presses get a deterministic message', () => {
    const block = src.slice(guardIdx, guardIdx + 2400);
    assert.match(block, /if \(isSpeculative\) return null;/);
    assert.match(block, /emit\('suggested_answer', noContextMsg/,
      'the emit resolves the renderer placeholder — returning without emitting hangs it');
    assert.match(block, /setMode\('idle'\)/);
    assert.match(block, /return noContextMsg;/);
  });

  test('ORDERING: the guard runs before planning, the turn contract, V3, and the provider', () => {
    assert.ok(guardIdx !== -1);
    for (const downstream of [
      'resolveCanonicalTurn(',
      'buildV3Prompt(',
      'this.whatToAnswerLLM.generateStream(',
    ]) {
      const idx = src.indexOf(downstream);
      assert.ok(idx !== -1, `${downstream} site moved — re-verify the guard still precedes it`);
      assert.ok(guardIdx < idx, `guard must precede ${downstream}`);
    }
  });

  test('a screen/DOM/image press with no transcript still proceeds (the screen IS the question)', () => {
    const block = src.slice(guardIdx, guardIdx + 2400);
    assert.match(block, /_wtaHasVisualContext/);
    assert.match(block, /&& !_wtaHasVisualContext\)/,
      'visual context must be part of the emptiness conjunction, not ignored');
  });
});
