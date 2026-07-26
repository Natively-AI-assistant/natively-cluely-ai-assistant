// electron/llm/__tests__/SdRequirementsGateTier0.test.mjs
//
// Tier 0 Requirements grilling gate suite (ticket 12).
// Pure helpers + stub-inject WhatToAnswerLLM for system_design_answer.
//
// Covers:
//   1. Structural gate while sdPhase=requirements
//   2. Soft-refuse premature advance (missing slots named)
//   3. LESSON inject allowlist Understanding/FR/NFR only while gated
//   4. Artifact reset on new SD problem
//   5. Checklist fill helpers / ask-once semantics
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdRequirementsGateTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distLlm, 'WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

function makeStubHelper(lessonChunks = [], spokenYield = null) {
  return {
    getPromptTier: () => 'tiny',
    getCapabilities: () => ({ outputBudgetTokens: 1000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    async *streamChat(userMessage) {
      // When spokenYield is set, emit canned spoken answer (structural tests).
      // Otherwise echo the assembled prompt (LESSON inject assertions).
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

const SD_ANSWER_PLAN = planAnswer({ question: 'Design a URL shortener', source: 'interviewer' });
const GENERAL_ANSWER_PLAN = planAnswer({ question: 'What is a binary search tree?', source: 'interviewer' });

function withPhase(plan, sdPhase) {
  return { ...plan, sdPhase };
}

const MIXED_LESSON_CHUNKS = [
  {
    text: [
      '## Understanding the Problem',
      'Clarify what the shortener must do.',
      '### Functional Requirements',
      'Create short links and redirect.',
      '### Non-Functional Requirements',
      'Low latency redirects.',
      '## The Set Up',
      'Pick a language and IDE.',
      '## Defining the Core Entities',
      'URL, User, Click.',
      '## The API',
      'POST /shorten',
      '## High-Level Design',
      'CDN in front of app servers and Redis.',
      '## Potential Deep Dives',
      'Base62 encoding tradeoffs.',
    ].join('\n'),
  },
];

// ── Pure: artifact + sdPhase + reset ─────────────────────────────────────────

describe('Requirements artifact / sdPhase / reset', () => {
  test('fresh artifact derives sdPhase=requirements with empty checklist', () => {
    const a = gate.createEmptyRequirementsArtifact('url-shortener');
    assert.equal(gate.deriveSdPhase(a), 'requirements');
    assert.equal(a.gateClosed, false);
    assert.equal(a.advanceAccepted, false);
    assert.equal(a.problemClass, 'crud_product');
    assert.equal(gate.isChecklistComplete(a), false);
  });

  test('gate closes only when checklist complete AND advance accepted', () => {
    let a = gate.createEmptyRequirementsArtifact('p1');
    for (const id of ['functional_requirements', 'scale_qps', 'latency', 'consistency_availability']) {
      a = gate.fillSlotFromInterviewer(a, id, 'filled');
    }
    assert.equal(gate.isChecklistComplete(a), true);
    assert.equal(gate.deriveSdPhase(a), 'requirements', 'completeness alone does not close');
    a = gate.acceptAdvance(a);
    assert.equal(a.gateClosed, true);
    assert.equal(gate.deriveSdPhase(a), 'post_requirements');
  });

  test('new SD problem reset clears filled slots and gate-closed flags', () => {
    let a = gate.createEmptyRequirementsArtifact('problem-a');
    a = gate.fillSlotFromInterviewer(a, 'functional_requirements', 'shorten URLs');
    a = gate.fillSlotFromInterviewer(a, 'scale_qps', '1k QPS');
    a = gate.fillSlotFromInterviewer(a, 'latency', '50ms');
    a = gate.fillSlotFromInterviewer(a, 'consistency_availability', 'availability');
    a = gate.acceptAdvance(a);
    assert.equal(gate.deriveSdPhase(a), 'post_requirements');

    const reset = gate.resetArtifactForNewSdProblem(a, 'problem-b');
    assert.equal(reset.problemKey, 'problem-b');
    assert.equal(reset.gateClosed, false);
    assert.equal(reset.advanceAccepted, false);
    assert.equal(gate.deriveSdPhase(reset), 'requirements');
    assert.equal(gate.isChecklistComplete(reset), false);
    assert.equal(reset.slots.functional_requirements.filled, false);
  });

  test('same problemKey does not reset', () => {
    let a = gate.createEmptyRequirementsArtifact('same');
    a = gate.fillSlotFromInterviewer(a, 'latency', '10ms');
    const again = gate.resetArtifactForNewSdProblem(a, 'same');
    assert.equal(again, a);
    assert.equal(again.slots.latency.filled, true);
  });
});

// ── Pure: structural heading gate ────────────────────────────────────────────

describe('Structural Delivery Framework heading gate', () => {
  test('while requirements, Core Entities / API / HLD / Deep Dive headings are stripped', () => {
    const spoken = [
      '## Requirements',
      'We need create + redirect.',
      '## Core Entities',
      'URL, User',
      '## API / Interface',
      'POST /shorten',
      '## High-Level Design',
      'CDN + Redis',
      '## Deep Dives',
      'Base62',
    ].join('\n');
    const out = gate.enforceStructuralGate(spoken, 'requirements');
    assert.match(out, /Requirements/);
    assert.doesNotMatch(out, /Core Entities/i);
    assert.doesNotMatch(out, /API\s*\/\s*Interface/i);
    assert.doesNotMatch(out, /High[- ]Level Design/i);
    assert.doesNotMatch(out, /Deep Dives?/i);
  });

  test('post_requirements allows later framework sections through', () => {
    const spoken = '## High-Level Design\nCDN + Redis\n## Deep Dives\nBase62\n';
    const out = gate.enforceStructuralGate(spoken, 'post_requirements');
    assert.match(out, /High-Level Design/);
    assert.match(out, /Deep Dives/);
  });

  test('compliant clarifiers + Requirements draft pass without truncate', () => {
    const spoken = 'Quick clarifying question — roughly what QPS are we targeting?\n\n## Requirements\n- create short links\n';
    assert.equal(gate.enforceStructuralGate(spoken, 'requirements'), spoken);
  });
});

// ── Pure: soft-refuse ────────────────────────────────────────────────────────

describe('Soft-refuse premature advance', () => {
  test('advance while mandatory empty → soft refuse names missing slots; no later headings', () => {
    const a = gate.createEmptyRequirementsArtifact('p');
    const result = gate.softRefuseIfPrematureAdvance(a, "let's move on to the design", 'mic');
    assert.equal(result.refused, true);
    assert.match(result.spoken, /functional requirements/i);
    assert.match(result.spoken, /scale \/ QPS/i);
    assert.match(result.spoken, /latency/i);
    assert.match(result.spoken, /consistency vs availability/i);
    assert.doesNotMatch(result.spoken, /Core Entities|High-Level Design|Deep Dives/i);
    assert.equal(gate.deriveSdPhase(result.artifact), 'requirements');
  });

  test('pipeline class + empty data_flow_stages is named on refuse', () => {
    let a = gate.createEmptyRequirementsArtifact('pipe');
    a = gate.setProblemClass(a, 'data_pipeline_streaming_analytics');
    for (const id of ['functional_requirements', 'scale_qps', 'latency', 'consistency_availability']) {
      a = gate.fillSlotFromInterviewer(a, id, 'ok');
    }
    const result = gate.softRefuseIfPrematureAdvance(a, 'ready to design', 'assistant');
    assert.equal(result.refused, true);
    assert.match(result.spoken, /data-flow stages/i);
  });

  test('CRUD ignores empty data_flow_stages; optionals empty still accept', () => {
    let a = gate.createEmptyRequirementsArtifact('crud');
    for (const id of ['functional_requirements', 'scale_qps', 'latency', 'consistency_availability']) {
      a = gate.fillSlotFromInterviewer(a, id, 'ok');
    }
    const result = gate.softRefuseIfPrematureAdvance(a, "let's move on", 'mic');
    assert.equal(result.refused, false);
    assert.equal(gate.deriveSdPhase(result.artifact), 'post_requirements');
  });

  test('interviewer-channel move on is not an advance', () => {
    const a = gate.createEmptyRequirementsArtifact('p');
    const result = gate.softRefuseIfPrematureAdvance(a, "let's move on", 'interviewer');
    assert.equal(result.refused, false);
    assert.equal(result.artifact.advanceAccepted, false);
  });
});

// ── Pure: checklist fill / ask-once ──────────────────────────────────────────

describe('Checklist fill helpers / ask-once', () => {
  test('assumption fill is blocked until ask-once', () => {
    let a = gate.createEmptyRequirementsArtifact('p');
    a = gate.fillSlotFromAssumption(a, 'latency', 'assume 100ms p99');
    assert.equal(a.slots.latency.filled, false);
    a = gate.markSlotAsked(a, 'latency');
    a = gate.fillSlotFromAssumption(a, 'latency', 'assume 100ms p99');
    assert.equal(a.slots.latency.filled, true);
    assert.equal(a.slots.latency.fillSource, 'assumption');
  });

  test('interviewer answer fills without ask', () => {
    let a = gate.createEmptyRequirementsArtifact('p');
    a = gate.fillSlotFromInterviewer(a, 'scale_qps', '10k QPS');
    assert.equal(a.slots.scale_qps.filled, true);
    assert.equal(a.slots.scale_qps.fillSource, 'interviewer');
  });

  test('optional slots never block completeness', () => {
    let a = gate.createEmptyRequirementsArtifact('p');
    for (const id of ['functional_requirements', 'scale_qps', 'latency', 'consistency_availability']) {
      a = gate.fillSlotFromInterviewer(a, id, 'ok');
    }
    assert.equal(gate.isChecklistComplete(a), true);
    assert.equal(a.slots.durability.filled, false);
    assert.equal(a.slots.read_write_ratio.filled, false);
  });
});

// ── Pure: LESSON allowlist filter ────────────────────────────────────────────

describe('LESSON section allowlist filter', () => {
  test('requirements phase keeps Understanding/FR/NFR only', () => {
    const filtered = gate.filterLessonChunksForPhase(MIXED_LESSON_CHUNKS, 'requirements');
    assert.equal(filtered.length, 1);
    const text = filtered[0].text;
    assert.match(text, /Understanding the Problem/);
    assert.match(text, /Functional Requirements/);
    assert.match(text, /Non-Functional Requirements/);
    assert.match(text, /Low latency redirects/);
    assert.doesNotMatch(text, /High-Level Design/);
    assert.doesNotMatch(text, /Deep Dives/);
    assert.doesNotMatch(text, /Core Entities/);
    assert.doesNotMatch(text, /The Set Up/);
    assert.doesNotMatch(text, /POST \/shorten/);
  });

  test('post_requirements is identity (full inject)', () => {
    const filtered = gate.filterLessonChunksForPhase(MIXED_LESSON_CHUNKS, 'post_requirements');
    assert.equal(filtered, MIXED_LESSON_CHUNKS);
    assert.match(filtered[0].text, /High-Level Design/);
  });

  test('all-excluded chunks → empty filter result', () => {
    const onlyHld = [{ text: '## High-Level Design\nCDN\n## Deep Dives\nBase62\n' }];
    const filtered = gate.filterLessonChunksForPhase(onlyHld, 'requirements');
    assert.equal(filtered.length, 0);
  });
});

// ── Integration: WhatToAnswerLLM seams ───────────────────────────────────────

describe('WhatToAnswerLLM Requirements gate wiring', () => {
  test('gated LESSON inject excludes HLD/Deep Dive bodies from reference_file', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(SD_ANSWER_PLAN, 'requirements'),
    ));
    assert.match(out, /<reference_file name="hellointerview-system-design\.md">/);
    assert.match(out, /Understanding the Problem|Functional Requirements|Non-Functional Requirements/);
    assert.doesNotMatch(out, /CDN in front of app servers/);
    assert.doesNotMatch(out, /Base62 encoding tradeoffs/);
    assert.match(out, /requirements_phase_contract/);
  });

  test('post_requirements restores full LESSON inject including HLD', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(SD_ANSWER_PLAN, 'post_requirements'),
    ));
    assert.match(out, /High-Level Design/);
    assert.match(out, /Potential Deep Dives|Deep Dives/);
    assert.doesNotMatch(out, /requirements_phase_contract/);
  });

  test('all chunks filtered → no reference_file; stream still non-empty', async () => {
    const onlyHld = [{ text: '## High-Level Design\nCDN\n' }];
    const llm = new WhatToAnswerLLM(makeStubHelper(onlyHld), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(SD_ANSWER_PLAN, 'requirements'),
    ));
    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/);
    assert.ok(out.length > 0);
  });

  test('structural gate soft-truncates spoken Core Entities+ while requirements', async () => {
    const leak = [
      'Clarifying: what QPS should we hit?',
      '## Core Entities',
      'URL, User',
      '## High-Level Design',
      'Redis cache',
      '## Deep Dives',
      'Base62',
    ].join('\n');
    const llm = new WhatToAnswerLLM(makeStubHelper([], leak), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(SD_ANSWER_PLAN, 'requirements'),
    ));
    assert.match(out, /Clarifying: what QPS/);
    assert.doesNotMatch(out, /Core Entities/i);
    assert.doesNotMatch(out, /High-Level Design/i);
    assert.doesNotMatch(out, /Deep Dives?/i);
  });

  test('structural gate inert when post_requirements', async () => {
    const leak = '## High-Level Design\nRedis\n## Deep Dives\nBase62\n';
    const llm = new WhatToAnswerLLM(makeStubHelper([], leak), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Design a URL shortener.',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(SD_ANSWER_PLAN, 'post_requirements'),
    ));
    assert.match(out, /High-Level Design/);
    assert.match(out, /Deep Dives/);
  });

  test('non-system_design answerType ignores gate (no lesson filter contract)', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(MIXED_LESSON_CHUNKS), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: What is a binary search tree?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      withPhase(GENERAL_ANSWER_PLAN, 'requirements'),
    ));
    assert.doesNotMatch(out, /<reference_file name="hellointerview-system-design\.md">/);
    assert.doesNotMatch(out, /requirements_phase_contract/);
  });
});
