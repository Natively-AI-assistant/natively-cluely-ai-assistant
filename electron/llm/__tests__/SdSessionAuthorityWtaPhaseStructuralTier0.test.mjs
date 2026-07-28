// electron/llm/__tests__/SdSessionAuthorityWtaPhaseStructuralTier0.test.mjs
//
// Ticket 02 — SdSessionAuthority: stamped sdPhase=requirements arms WTA phase
// contract + structural Delivery Framework hard-block on general_meeting_answer
// clarifiers. LESSON allowlist / deep-dive pack stay system_design_answer-only.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdSessionAuthorityWtaPhaseStructuralTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distLlm, 'WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

function makeStubHelper(lessonChunks = [], spokenYield = null) {
  return {
    getPromptTier: () => 'tiny',
    getCapabilities: () => ({ outputBudgetTokens: 1000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    async *streamChat(userMessage) {
      yield spokenYield != null ? spokenYield : userMessage;
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

const TI = 'technical-interview';

function gmClarifierPlan(sdPhase, sdGrill = undefined) {
  const planned = planAnswer({
    question: 'For analytics, total clicks only or geo/device?',
    source: 'what_to_answer',
    activeMode: { templateType: TI, name: 'SD Interview Sim T2' },
  });
  assert.equal(planned.answerType, 'general_meeting_answer');
  return { ...planned, sdPhase, ...(sdGrill ? { sdGrill } : {}) };
}

const MIXED_LESSON_CHUNKS = [
  {
    similarity: 0.9,
    text: [
      '## Understanding the Problem',
      'Clarify what the shortener must do.',
      '### Functional Requirements',
      'Create short links and redirect.',
      '## High-Level Design',
      'CDN in front of app servers and Redis.',
      '## Potential Deep Dives',
      'Base62 encoding tradeoffs.',
    ].join('\n'),
  },
];

const DF_LEAK = [
  'Clarifying: geo vs total clicks?',
  '## Core Entities',
  'URL, User',
  '## High-Level Design',
  'Redis cache',
  '## Deep Dives',
  'Base62',
].join('\n');

describe('SdSessionAuthority WTA phase + structural under stamped phase', () => {
  test('GM + sdPhase=requirements injects phase contract', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: For analytics, total clicks only or geo/device?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gmClarifierPlan('requirements', { nextSlots: ['scale_qps'], clarifierBudget: 1 }),
    ));
    assert.match(out, /requirements_phase_contract/);
  });

  test('GM + sdPhase=requirements structurally hard-blocks DF headings', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper([], DF_LEAK), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: For analytics, total clicks only or geo/device?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gmClarifierPlan('requirements'),
    ));
    assert.match(out, /Clarifying: geo vs total clicks/);
    assert.doesNotMatch(out, /Core Entities/i);
    assert.doesNotMatch(out, /High-Level Design/i);
    assert.doesNotMatch(out, /Deep Dives?/i);
  });

  test('GM + sdPhase=post_requirements does not leave Requirements structural hard-block active', async () => {
    const leak = '## High-Level Design\nRedis\n## Deep Dives\nBase62\n';
    const llm = new WhatToAnswerLLM(makeStubHelper([], leak), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: For analytics, total clicks only or geo/device?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gmClarifierPlan('post_requirements'),
    ));
    assert.match(out, /High-Level Design/);
    assert.match(out, /Deep Dives/);
    assert.doesNotMatch(out, /requirements_phase_contract/);
  });

  test('GM + sdPhase=requirements does not arm LESSON reference_file', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: For analytics, total clicks only or geo/device?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gmClarifierPlan('requirements'),
    ));
    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/);
    assert.doesNotMatch(out, /CDN in front of app servers/);
    assert.doesNotMatch(out, /Base62 encoding tradeoffs/);
  });

  test('GM + sdPhase=post_requirements does not inject deep-dive context pack', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: For analytics, total clicks only or geo/device?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      gmClarifierPlan('post_requirements'),
      undefined,
      {
        sdDeepDive: {
          designSheet: { problemKey: 'url', committed: [{ id: 'c1', text: 'API: POST /shorten' }] },
          recentSdAnswers: { answers: [] },
          latestInterviewer: 'For analytics, total clicks only or geo/device?',
        },
      },
    ));
    assert.doesNotMatch(out, /design_sheet/);
    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/);
  });
});
