// electron/llm/__tests__/SystemDesignLessonGrounding2026_07_21.test.mjs
//
// Stub-inject tests for the LESSON grounding path in WhatToAnswerLLM.
// Drives the REAL compiled WhatToAnswerLLM with:
//   - an echo stub for streamChat (captures the assembled prompt)
//   - a fake getKnowledgeOrchestrator that returns canned LESSON chunks
//
// Proves:
//   Test A: system_design_answer → <reference_file> block injected with chunks
//   Test B: system_design_answer + no chunks → stream still delivers, no block
//   Test C: non-system-design answerType → grounding does NOT fire
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SystemDesignLessonGrounding2026_07_21.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distLlm, 'WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

function makeStubHelper(lessonChunks = []) {
  return {
    getPromptTier: () => 'tiny',
    getCapabilities: () => ({ outputBudgetTokens: 1000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    async *streamChat(userMessage) {
      yield userMessage;
    },
    getKnowledgeOrchestrator: () => ({
      queryRelevantChunks: async () => lessonChunks,
    }),
  };
}

const stubModes = {
  getActiveModeSystemPromptSuffix: () => '',
  buildActiveModeContextBlock: () => '',
  buildRetrievedActiveModeContextBlock: () => '',
};

async function collect(gen) {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

const SD_ANSWER_PLAN = planAnswer({ question: 'Design a URL shortener', source: 'interviewer' });
const GENERAL_ANSWER_PLAN = planAnswer({ question: 'What is a binary search tree?', source: 'interviewer' });

describe('WhatToAnswerLLM system-design lesson grounding', () => {
  test('A: chunks are injected as <reference_file> block when orchestrator returns results', async () => {
    const chunks = [
      { text: 'Use consistent hashing for load balancing across nodes.', similarity: 0.9 },
      { text: 'CAP theorem: choose 2 of consistency, availability, partition tolerance.', similarity: 0.85 },
    ];
    const llm = new WhatToAnswerLLM(makeStubHelper(chunks), stubModes);

    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      SD_ANSWER_PLAN,
    ));

    assert.match(out, /<reference_file name="hellointerview-system-design\.md">/, 'reference_file block must be present');
    assert.match(out, /consistent hashing/, 'first chunk text must appear in prompt');
    assert.match(out, /CAP theorem/, 'second chunk text must appear in prompt');
  });

  test('B: no chunks from orchestrator → stream still delivers, no reference_file block', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper([]), stubModes);

    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      SD_ANSWER_PLAN,
    ));

    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/, 'no reference_file when no chunks');
    assert.ok(out.length > 0, 'stream must still produce output when grounding misses');
  });

  test('C: non-system-design answerType → grounding does not fire even with orchestrator present', async () => {
    const chunks = [
      { text: 'This should never appear in a coding answer.', similarity: 0.9 },
    ];
    const llm = new WhatToAnswerLLM(makeStubHelper(chunks), stubModes);

    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: What is a binary search tree?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      GENERAL_ANSWER_PLAN,
    ));

    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/, 'lesson grounding must not fire on non-SD turns');
  });
});
