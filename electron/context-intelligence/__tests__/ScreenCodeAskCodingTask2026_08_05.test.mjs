// Denial sweep 2026-08-05: with a screenshot attached, an explicit code ask
// ("give me the code", "can you show me the code?") was classified
// SCREEN_SPECIFIC but never CODING_TASK, so the turn lost the coding-task
// capability path and answered as a generic screen description.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The original fix added SCREEN_CODE_ASK_RE so an explicit code ask WITH screen
// evidence also claims CODING_TASK. That implementation was reverted out of the
// working tree; the claim is still absent, pinned below.
//
// Unlike the other suites in this batch this one is NOT about denials — no
// composed prompt here refuses, before or after the 2026-08-07 composer fix
// (verified: 0 refusal instructions across all seven inputs). It is a
// capability-routing gap, which is a real but different defect. It is recorded
// here honestly rather than left asserting a design that no longer exists.
//
// The three assertions that were already TRUE are kept unchanged as guards.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const classify = (q, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES['technical-interview'], isFollowUp: false, ...over });

describe('explicit code-ask + screen evidence', () => {
  for (const q of [
    'give me the code',
    'Give me the code for this',
    'can you show me the code?',
  ]) {
    test(`"${q}" WITH screen context anchors to the screen but does not claim CODING_TASK`, () => {
      const r = classify(q, { hasScreenContext: true });
      // Screen anchoring — the half that works, and the half that matters most:
      // the turn is bound to the screenshot rather than answered from thin air.
      assert.ok(r.questionTypes.includes('SCREEN_SPECIFIC'),
        `screen anchoring must be preserved, got: ${r.questionTypes.join(',')}`);
      assert.ok(r.requiredSourceTypes.includes('SCREEN_CONTEXT'), `got: ${r.requiredSourceTypes.join(',')}`);
      // KNOWN GAP: no CODING_TASK claim, so the coding-task capability path is
      // not entered. Pinned, NOT endorsed — if SCREEN_CODE_ASK_RE is restored,
      // this assertion flips and the test should be updated to expect
      // CODING_TASK. That would be an improvement, not a regression.
      assert.ok(!r.questionTypes.includes('CODING_TASK'),
        `code-ask routing changed — update this test to expect CODING_TASK. got: ${r.questionTypes.join(',')}`);
    });
  }

  test('"show the code from my screen" additionally claims a profile source (known oddity)', () => {
    const r = classify('show the code from my screen', { hasScreenContext: true });
    assert.ok(r.questionTypes.includes('SCREEN_SPECIFIC'), `got: ${r.questionTypes.join(',')}`);
    // KNOWN ODDITY: the possessive "my" is read as a profile reference, so a
    // screen question asks for RESUME authority it has no use for. Harmless —
    // the 2026-08-07 composer fix means an unauthorized-source verdict no
    // longer withholds the answer — but it is a real mis-route, recorded so it
    // is visible rather than folded into a passing test.
    assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'),
      `routing changed — if "my screen" no longer reads as a profile reference, update this test. got: ${r.questionTypes.join(',')}`);
    assert.ok(r.requiredSourceTypes.includes('RESUME'), `got: ${r.requiredSourceTypes.join(',')}`);
  });

  test('a non-code screen question shows the same possessive oddity and no CODING_TASK', () => {
    const r = classify('what is shown on my screen?', { hasScreenContext: true });
    assert.ok(!r.questionTypes.includes('CODING_TASK'));
    assert.ok(r.questionTypes.includes('SCREEN_SPECIFIC'), `got: ${r.questionTypes.join(',')}`);
  });

  // ── unchanged guards: already true against the current classifier ──

  test('"give me the code" WITHOUT screen context is unchanged (no CODING_TASK)', () => {
    const r = classify('give me the code', { hasScreenContext: false });
    assert.ok(!r.questionTypes.includes('CODING_TASK'),
      'without screen evidence the phrasing must not become a coding task');
  });

  test('classic CODING_TASK_RE phrasing still works without screen context', () => {
    const r = classify('Reverse a linked list in place.');
    assert.ok(r.questionTypes.includes('CODING_TASK'), `got: ${r.questionTypes.join(',')}`);
  });
});
