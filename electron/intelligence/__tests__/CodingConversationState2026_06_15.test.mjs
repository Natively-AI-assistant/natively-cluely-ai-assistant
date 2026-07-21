// electron/intelligence/__tests__/CodingConversationState2026_06_15.test.mjs
//
// Property tests for CodingConversationState (spoken-answer-quality sprint). A multi-turn
// coding thread must keep the ORIGINAL problem sticky while CURRENT advances, so
// complexity/dry-run/optimize follow-ups resolve to the current problem and "what was the
// original problem?" resolves to the first one. No fixed answer strings; behavioural.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { CodingConversationState } from '../../../dist-electron/electron/intelligence/CodingConversationState.js';

const codeAns = (fn) => '```python\ndef ' + fn + '():\n    return None\n```';
let clock = 0;
const turn = (s, sid, msg, ans, contract, cont) =>
  s.recordCodingTurn(sid, { userMessage: msg, assistantAnswer: ans, explicitContract: contract, isContinuation: cont, timestamp: ++clock });

describe('CodingConversationState — original stays, current advances', () => {
  test('first problem sets original + current', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum in Python', codeAns('twoSum'), null, false);
    const snap = s.get('a');
    assert.match(snap.originalProblem, /Two Sum/);
    assert.match(snap.currentProblem, /Two Sum/);
  });

  test('continuation keeps the current problem', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum in Python', codeAns('twoSum'), null, false);
    turn(s, 'a', 'give time and space complexity', 'O(n) time, O(n) space', 'complexity_only', true);
    const r = s.resolveProblemFor('a', 'what is the complexity');
    assert.match(r.problem, /Two Sum/);
    assert.equal(r.isOriginal, false);
  });

  test('a new problem advances current but ORIGINAL stays the first problem', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum in Python', codeAns('twoSum'), null, false);
    turn(s, 'a', 'now optimize it', codeAns('twoSumFast'), null, true);
    turn(s, 'a', 'Solve Valid Parentheses in Python', codeAns('isValid'), null, false);
    // current = Valid Parentheses
    assert.match(s.resolveProblemFor('a', 'complexity?').problem, /Valid Parentheses/);
    // original = Two Sum (sticky)
    const orig = s.resolveProblemFor('a', 'what was the original problem I asked?');
    assert.equal(orig.isOriginal, true);
    assert.match(orig.problem, /Two Sum/);
  });

  test('isOriginalProblemQuery detects the phrasing variants', () => {
    const s = new CodingConversationState();
    for (const q of [
      'what was the original problem I asked?',
      'what was the first problem?',
      'remind me of the initial problem',
      'what did I originally ask you to solve?',
    ]) {
      assert.equal(s.isOriginalProblemQuery(q), true, q);
    }
    for (const q of ['what is the complexity?', 'optimize it', 'dry run this']) {
      assert.equal(s.isOriginalProblemQuery(q), false, q);
    }
  });

  test('variant + language are tracked across continuations', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum', codeAns('twoSum'), null, false);
    turn(s, 'a', 'make it iterative', codeAns('twoSumIter'), null, true);
    const snap = s.get('a');
    assert.equal(snap.lastLanguage, 'python');
    assert.equal(snap.currentVariant, 'iterative');
  });

  test('dry-run input is captured', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum', codeAns('twoSum'), null, false);
    turn(s, 'a', 'dry run this with [2,7,11,15], target 9', 'i=0...', 'dry_run_only', true);
    assert.match(s.get('a').lastDryRunInput, /\[2,7,11,15\]/);
  });

  test('sessions are isolated and clearable', () => {
    const s = new CodingConversationState();
    turn(s, 'a', 'Solve Two Sum', codeAns('twoSum'), null, false);
    turn(s, 'b', 'Solve Merge Sort', codeAns('mergeSort'), null, false);
    assert.match(s.resolveProblemFor('a', 'complexity').problem, /Two Sum/);
    assert.match(s.resolveProblemFor('b', 'complexity').problem, /Merge Sort/);
    s.clearSession('a');
    assert.equal(s.resolveProblemFor('a', 'complexity'), null);
    assert.match(s.resolveProblemFor('b', 'complexity').problem, /Merge Sort/);
  });

  test('never throws on malformed input', () => {
    const s = new CodingConversationState();
    assert.doesNotThrow(() => turn(s, 'a', '', '', null, false));
    assert.equal(s.resolveProblemFor('nope', 'x'), null);
  });
});
