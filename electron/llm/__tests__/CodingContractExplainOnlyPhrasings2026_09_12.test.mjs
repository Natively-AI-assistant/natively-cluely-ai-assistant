// electron/llm/__tests__/CodingContractExplainOnlyPhrasings2026_09_12.test.mjs
//
// In-app review (2026-09-07, Windows, 3★): "it keeps giving code answers even when
// you tell it not to". The explain-only detector only matched a closed verb list
// ("don't write/use/include/give ... code"), so the natural ways a user pushes
// back mid-session — "stop giving me code", "I don't want code", "no more code
// answers" — fell through to the six-section coding contract, which then had the
// post-stream repair re-inject a Code section.
//
// Runs against the compiled dist-electron output, like the sibling contract tests.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { detectExplicitCodingContract } from '../../../dist-electron/electron/llm/index.js';

describe('detectExplicitCodingContract — natural "no code" push-back phrasings', () => {
  const explainOnly = [
    'stop giving me code',
    'Stop giving me code answers.',
    "I don't want code",
    "I don't want any code, just explain the approach",
    'no more code answers please',
    "please don't answer with code",
    "don't show code",
    "don't respond with code",
    'never output code',
    'answer in words not code',
    'why do you keep giving me code? I asked for an explanation',
  ];

  for (const q of explainOnly) {
    test(`"${q}" → explain_only`, () => {
      assert.equal(detectExplicitCodingContract(q), 'explain_only');
    });
  }

  // A qualifier after "code" means the user is talking ABOUT the code, not
  // refusing it. These must stay on the default (null) contract.
  const notExplainOnly = [
    "I don't want the code to crash on empty input",
    "don't give me code that uses recursion, use a stack instead",
    'stop the code from allocating in the loop',
  ];

  for (const q of notExplainOnly) {
    test(`"${q}" → not explain_only`, () => {
      assert.notEqual(detectExplicitCodingContract(q), 'explain_only');
    });
  }

  test('code_only still wins over an explain-only phrasing in the same message', () => {
    assert.equal(detectExplicitCodingContract('no explanation, just the code'), 'code_only');
  });
});
