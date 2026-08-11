// electron/context-intelligence/__tests__/CodingTaskFromRouter2026_08_11.test.mjs
//
// Direct-evidence follow-up to the V3 coding-contract fix. Dumping the system
// prompt that actually reaches the provider showed the contract present on one
// coding turn and ABSENT on another:
//
//   [lru] prompt=17157ch contract=true   <- "Implement an LRU cache ..."
//   [bfs] prompt=14430ch contract=false  <- "Write a BFS shortest-path function ..."
//
// Both route to a coding answerType via AnswerPlanner (coding_question_answer
// and dsa_question_answer respectively). The divergence is that the bridge does
// not ask the router — it re-derives the flag from V3's own keyword regex:
//
//   codingTask: result.decision.questionTypes.includes('CODING_TASK')
//
// and CODING_TASK_RE (turn-classifier.ts:343) is a hand-maintained keyword list:
//   reverse a | implement (a|an) | write (a|the) (code|function|program|query)
//   | solve | algorithm for | time complexity | leetcode | binary search
//   | linked list | sort(ing)? algorithm | dynamic programming
//
// "Write a BFS shortest-path function" matches none of them — "write a function"
// is split by the word "BFS shortest-path". Neither does "Given a binary tree,
// return its level order traversal". Both are ordinary interview questions.
//
// This matters because that flag gates the six-section coding contract. A miss
// means the model is never told to produce Complexity or a Dry Run, and the
// downstream repair then paints "O(?) — state the actual time bound" into
// sections the model was never asked for — the exact live symptom.
//
// The bridge's own comment says detection "stays with the existing
// deterministic router (AnswerPlanner), never re-derived here from text".
// These tests pin that: the caller's routed answerType decides, and the regex
// is only a fallback for callers that supply none.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAnswer, isCodingAnswerType } from '../../../dist-electron/electron/llm/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(__dirname, '../orchestration/engine-bridge.ts');
const bridgeSrc = fs.readFileSync(BRIDGE, 'utf8');

// Real interview questions the keyword regex misses but the router classifies
// correctly. These are not edge cases — they are how questions are normally
// phrased out loud.
const ROUTER_CODING_QUESTIONS = [
  'Write a BFS shortest-path function for an unweighted graph in Python. Explain the approach first.',
  'Given a binary tree, return its level order traversal.',
  'Implement an LRU cache in Python with get and put. Explain the approach first.',
  'Write a Python function to reverse a linked list. Explain the approach first.',
];

describe('the router, not a keyword list, decides codingTask', () => {
  test('every fixture really is a coding turn per AnswerPlanner', () => {
    for (const q of ROUTER_CODING_QUESTIONS) {
      const plan = planAnswer({ question: q, transcript: '', answerSource: 'what_to_answer' });
      assert.ok(
        isCodingAnswerType(plan.answerType),
        `precondition failed — AnswerPlanner does not consider this coding: ${q} -> ${plan.answerType}`,
      );
    }
  });

  test('BridgeInput accepts the caller\'s routed coding decision', () => {
    assert.match(
      bridgeSrc,
      /codingTask\?:\s*boolean/,
      'BridgeInput must accept a routed codingTask so callers can pass AnswerPlanner\'s verdict',
    );
  });

  test('the routed value takes precedence over the keyword regex', () => {
    // The regex may remain as a fallback for callers that pass nothing, but a
    // caller-supplied boolean must win — otherwise a routed coding turn can
    // still lose the contract to a keyword miss.
    assert.match(
      bridgeSrc,
      /codingTask:\s*input\.codingTask\s*\?\?/,
      'the bridge must prefer input.codingTask over its own questionTypes check',
    );
  });

  test('WTA passes its routed answerType decision into the bridge', () => {
    const ENGINE = path.resolve(__dirname, '../../IntelligenceEngine.ts');
    const engineSrc = fs.readFileSync(ENGINE, 'utf8');
    const start = engineSrc.indexOf('const wtaV3Prompt = await');
    const end = engineSrc.indexOf('const requestSnapshot', start);
    const call = engineSrc.slice(start, end);
    assert.match(
      call,
      /codingTask:\s*isCodingAnswerType\(/,
      'WTA must hand the bridge its own routed coding verdict',
    );
  });
});
