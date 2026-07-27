// electron/llm/__tests__/SdDeepDiveLiveWiringTier0.test.mjs
//
// Live wiring for post-gate SD deep-dive (SPECs 05/06/07):
//   1. WhatToAnswerLLM post-gate builds context pack + runs soft checks
//   2. Requirements path identity (ad-hoc LESSON + structural gate unchanged)
//   3. applyCompletedSdAnswerToArtifact trigger / skip / recent upsert
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdDeepDiveLiveWiringTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdDeepDiveLive.js')).href);
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

const SD_PLAN = {
  ...planAnswer({ question: 'Design a URL shortener', source: 'interviewer' }),
  answerType: 'system_design_answer',
};

const LESSON = [
  {
    similarity: 0.9,
    text: [
      '## Potential Deep Dives',
      'Base62 encoding tradeoffs.',
      '## High-Level Design',
      'CDN in front of app servers and Redis.',
    ].join('\n'),
  },
];

describe('WhatToAnswerLLM post-gate pack + soft checks', () => {
  test('post_requirements injects design_sheet + latest_interviewer + LESSON pack floor', async () => {
    const sheet = gate.createEmptySdDesignSheet('url');
    sheet.committed = [
      {
        id: 'e1',
        section: 'entities',
        text: 'URL maps to a short code',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 1,
      },
    ];
    const recent = gate.createEmptyRecentSdAnswers('url');
    recent.items = [
      { answerId: 'r1', capturedAt: 1, text: 'We start with entities URL and User.' },
    ];

    const snapshot = Object.freeze({
      activeModeInfo: null,
      modeId: 'technical-interview',
      requestId: 't1',
      surface: 'what_to_answer',
      generationId: 1,
      sdDeepDive: {
        designSheet: sheet,
        recentSdAnswers: recent,
        latestInterviewer: 'How would you handle cache invalidation?',
      },
    });

    const llm = new WhatToAnswerLLM(makeStubHelper(LESSON), stubModes);
    const out = await collect(
      llm.generateStream(
        '[INTERVIEWER]: How would you handle cache invalidation?',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { ...SD_PLAN, sdPhase: 'post_requirements' },
        undefined,
        snapshot,
      ),
    );

    assert.match(out, /<design_sheet>/);
    assert.match(out, /URL maps to a short code/);
    assert.match(out, /<latest_interviewer>/);
    assert.match(out, /cache invalidation/i);
    assert.match(out, /<reference_file\b/);
    assert.match(out, /Base62 encoding tradeoffs/);
    assert.match(out, /<recent_sd_answers>/);
    assert.match(out, /We start with entities/);
    assert.doesNotMatch(out, /requirements_phase_contract/);
    // Soft checks must not hard-refuse / blank the stream.
    assert.ok(out.trim().length > 20);
  });

  test('post-gate soft check labels assumption when LESSON omitted', async () => {
    const spoken = 'I would put Redis in front of Postgres at 100k QPS.';
    const llm = new WhatToAnswerLLM(makeStubHelper([], spoken), stubModes);
    const out = await collect(
      llm.generateStream(
        '[INTERVIEWER]: Walk me through the HLD.',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { ...SD_PLAN, sdPhase: 'post_requirements' },
      ),
    );
    assert.match(out, /As a design assumption:/i);
    assert.match(out, /100k\s*\[figure unverified\]/);
  });

  test('requirements path keeps named LESSON reference_file (prompt echo)', async () => {
    const llm = new WhatToAnswerLLM(
      makeStubHelper([
        { similarity: 0.9, text: '## Understanding the Problem\nClarify scope.\n## High-Level Design\nCDN\n' },
      ]),
      stubModes,
    );
    const out = await collect(
      llm.generateStream(
        '[INTERVIEWER]: Design a URL shortener.',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { ...SD_PLAN, sdPhase: 'requirements' },
      ),
    );
    assert.match(out, /<reference_file name="hellointerview-system-design\.md">/);
    assert.match(out, /Understanding the Problem/);
    assert.doesNotMatch(out, /<design_sheet>/);
    assert.doesNotMatch(out, /CDN/);
    assert.match(out, /requirements_phase_contract/);
  });

  test('requirements path structural truncate without deep-dive soft labels', async () => {
    const leak = [
      'Clarifying: what QPS?',
      '## Core Entities',
      'URL, User',
    ].join('\n');
    const llm = new WhatToAnswerLLM(makeStubHelper([], leak), stubModes);
    const out = await collect(
      llm.generateStream(
        '[INTERVIEWER]: Design a URL shortener.',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { ...SD_PLAN, sdPhase: 'requirements' },
      ),
    );
    assert.match(out, /Clarifying: what QPS/);
    assert.doesNotMatch(out, /Core Entities/i);
    assert.doesNotMatch(out, /As a design assumption:/i);
  });

  test('unset sdPhase treated as post-gate (pack + soft checks)', async () => {
    const spoken = 'Use a write-through cache.';
    const llm = new WhatToAnswerLLM(makeStubHelper([], spoken), stubModes);
    const out = await collect(
      llm.generateStream(
        '[INTERVIEWER]: Continue.',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { ...SD_PLAN, sdPhase: undefined },
      ),
    );
    assert.match(out, /As a design assumption:/i);
    assert.match(out, /write-through cache/);
  });
});

describe('applyCompletedSdAnswerToArtifact (SPEC 05 trigger)', () => {
  test('post_requirements upserts recent window from spoken text', () => {
    let artifact = gate.createEmptyRequirementsArtifact('url');
    artifact = gate.ensureSdDeepDiveExtension(artifact);
    const result = live.applyCompletedSdAnswerToArtifact({
      artifact,
      spokenText: 'COMMIT id=entities:url section=entities text=URL maps short to long\nWe store mappings in Redis.',
      meetingId: 'm1',
      currentMeetingId: 'm1',
      answerType: 'system_design_answer',
      sdPhase: 'post_requirements',
      now: 1_700_000_000_000,
    });
    assert.equal(result.applied, true);
    assert.equal(result.discarded, false);
    assert.equal(result.artifact.recentSdAnswers.items.length, 1);
    assert.match(result.artifact.recentSdAnswers.items[0].text, /Redis/);
    assert.ok(result.artifact.designSheet.committed.some((c) => c.id === 'entities:url' && c.status === 'committed'));
  });

  test('requirements phase is identity skip', () => {
    let artifact = gate.createEmptyRequirementsArtifact('url');
    artifact = gate.ensureSdDeepDiveExtension(artifact);
    const before = JSON.stringify(artifact.recentSdAnswers);
    const result = live.applyCompletedSdAnswerToArtifact({
      artifact,
      spokenText: 'COMMIT id=x section=entities text=should-not-merge',
      meetingId: 'm1',
      currentMeetingId: 'm1',
      answerType: 'system_design_answer',
      sdPhase: 'requirements',
    });
    assert.equal(result.applied, false);
    assert.equal(JSON.stringify(result.artifact.recentSdAnswers), before);
  });

  test('blockedFromSessionTracker skips merge', () => {
    let artifact = gate.createEmptyRequirementsArtifact('url');
    artifact = gate.ensureSdDeepDiveExtension(artifact);
    const result = live.applyCompletedSdAnswerToArtifact({
      artifact,
      spokenText: 'COMMIT id=x section=entities text=blocked',
      meetingId: 'm1',
      currentMeetingId: 'm1',
      answerType: 'system_design_answer',
      sdPhase: 'post_requirements',
      blockedFromSessionTracker: true,
    });
    assert.equal(result.applied, false);
    assert.deepEqual(result.artifact.recentSdAnswers.items, []);
  });

  test('meetingId race discards merge', () => {
    let artifact = gate.createEmptyRequirementsArtifact('url');
    artifact = gate.ensureSdDeepDiveExtension(artifact);
    const result = live.applyCompletedSdAnswerToArtifact({
      artifact,
      spokenText: 'COMMIT id=x section=entities text=stale',
      meetingId: 'old-meeting',
      currentMeetingId: 'new-meeting',
      answerType: 'system_design_answer',
      sdPhase: 'post_requirements',
    });
    assert.equal(result.applied, false);
    assert.equal(result.discarded, true);
    assert.deepEqual(result.artifact.recentSdAnswers.items, []);
  });
});
