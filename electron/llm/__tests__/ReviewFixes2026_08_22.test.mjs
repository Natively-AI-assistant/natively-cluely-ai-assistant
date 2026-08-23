// electron/llm/__tests__/ReviewFixes2026_08_22.test.mjs
//
// Regressions for the 2026-08-22 code-review findings on the session-C fix
// branch that aren't covered by the extended RC suites:
//   - TASK_DIRECTIVE matched bare "sort" in the backchannel "Sort of, yes,
//     that's close." (0.75-confidence answerable "ask" hijacking latest-wins),
//     while merge/compute/calculate/invert/traverse were missing from the
//     verb allowlist (those imperative asks scored 0.3 and lost grounding).
//   - The screen-coding promotion was hand-rolled divergently at three call
//     sites with no structural-code requirement on captured TEXT, so any
//     captured page (a CRM dashboard, a JD) promoted a blind/deictic press to
//     a full DSA turn. isPromotedScreenCodingTurn is now the single shared
//     predicate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { TASK_DIRECTIVE } = await import(dist('questionShapes.js'));
const { isPromotedScreenCodingTurn } = await import(dist('codingPromptSignals.js'));

describe('TASK_DIRECTIVE: backchannels are not tasks; real imperative verbs are', () => {
  for (const notTask of [
    "Sort of, yes, that's close.",
    'Sort of. That matches what I expected.',
    "Kind of, yeah — that's the idea.",
  ]) {
    test(`not a task: "${notTask}"`, () => {
      assert.equal(TASK_DIRECTIVE.test(notTask), false, notTask);
    });
  }

  for (const task of [
    'Sort this array in place without extra memory.',
    'Okay, merge the two sorted lists.',
    'Now compute the running median.',
    'Calculate the time complexity of that approach.',
    'Invert the binary tree.',
    'Traverse the graph breadth-first.',
    'Solve two sum.',
  ]) {
    test(`is a task: "${task}"`, () => {
      assert.equal(TASK_DIRECTIVE.test(task), true, task);
    });
  }
});

describe('isPromotedScreenCodingTurn: one predicate, structural-text requirement', () => {
  const CODE_STUB = 'class Solution:\n    def twoSum(self, nums, target):\n        pass';
  const CRM_PAGE = 'Acme CRM — Q3 Pipeline\nOpen deals: 42\nTop account: Globex ($120k)\nNext review: Thursday';

  test('captured CODE + blind press promotes', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: '', hasImages: false, screenText: CODE_STUB }), true);
  });

  test('captured CODE + deictic ask promotes', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: 'how do I do this?', hasImages: false, screenText: CODE_STUB }), true);
  });

  test('a NON-code page (CRM dashboard) never promotes — the confirmed finding', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: '', hasImages: false, screenText: CRM_PAGE }), false);
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: 'can you walk me through it?', hasImages: false, screenText: CRM_PAGE }), false);
  });

  test('an attached IMAGE still promotes (pixels cannot be inspected; the live defect was image-based)', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: '', hasImages: true, screenText: undefined }), true);
  });

  test('a real, non-deictic question never promotes regardless of screen', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: 'Tell me about your experience with Redis in production systems.', hasImages: true, screenText: CODE_STUB }), false);
  });

  test('an already-coding turn is not "promoted"', () => {
    assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: true, question: '', hasImages: true, screenText: CODE_STUB }), false);
  });
});
