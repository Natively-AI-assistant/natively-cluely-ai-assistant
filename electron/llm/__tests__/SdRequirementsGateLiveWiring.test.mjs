// electron/llm/__tests__/SdRequirementsGateLiveWiring.test.mjs
//
// Live wiring for SD Requirements grilling gate:
//   1. prepareSdRequirementsForAnswerPlan stamps sdPhase from artifact
//   2. SessionTracker working copy get/set/clear + reset clears live
//   3. Meeting DB checkpoint roundtrip (same meeting) + no cross-meeting hydrate
//   4. WhatToAnswerLLM structural gate activates when live prepare sets sdPhase
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdRequirementsGateLiveWiring.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distElectron = path.resolve(__dirname, '../../../dist-electron/electron');
const distLlm = path.join(distElectron, 'llm');
const DB_PATH = path.join(distElectron, 'db/DatabaseManager.js');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distLlm, 'WhatToAnswerLLM.js')).href);
const { SessionTracker } = await import(pathToFileURL(path.join(distElectron, 'SessionTracker.js')).href);

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

async function collectStream(gen) {
  let out = '';
  for await (const t of gen) out += String(t);
  return out;
}

describe('prepareSdRequirementsForAnswerPlan (live stamp)', () => {
  test('non-SD answer types leave sdPhase unset and artifact untouched', () => {
    const plan = planAnswer({
      question: 'Tell me about a conflict at work',
      source: 'what_to_answer',
      speakerPerspective: 'interviewer',
    });
    // Force non-SD if planner fluctuates
    const forced = { ...plan, answerType: 'behavioral_answer' };
    const prior = gate.createEmptyRequirementsArtifact('prior');
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: forced,
      artifact: prior,
      problemQuestion: 'behavioral',
      interviewerTexts: ['prefer availability'],
    });
    assert.equal(out.sdPhase, undefined);
    assert.equal(out.answerPlan.sdPhase, undefined);
    assert.equal(out.artifact, prior);
  });

  test('system_design_answer derives sdPhase=requirements and fills from interviewer text', () => {
    const plan = {
      ...planAnswer({
        question: 'Design a URL shortener',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
      }),
      answerType: 'system_design_answer',
    };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a URL shortener',
      interviewerTexts: [
        'Functional requirements: create short links and redirect',
        'Scale about 100k QPS',
        'latency under 100ms p99',
        'prefer availability over consistency',
      ],
    });
    assert.equal(out.sdPhase, 'requirements');
    assert.equal(out.answerPlan.sdPhase, 'requirements');
    assert.ok(out.artifact);
    assert.equal(out.artifact.slots.scale_qps.filled, true);
    assert.equal(out.artifact.slots.latency.filled, true);
    assert.equal(out.artifact.gateClosed, false);
  });

  test('candidateFillTexts fills remaining slots after empty interviewer (SPEC 13)', () => {
    const plan = {
      ...planAnswer({
        question: 'Design a URL shortener like Bitly.',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
      }),
      answerType: 'system_design_answer',
    };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a URL shortener like Bitly.',
      interviewerTexts: ['Where would you like to start?'],
      candidateFillTexts: [
        'Functional requirements: create short links and redirect',
        'Scale about 100k QPS with latency under 100ms p99',
        'prefer availability over consistency',
      ],
    });
    assert.equal(out.sdPhase, 'requirements');
    assert.ok(out.artifact);
    assert.equal(out.artifact.slots.functional_requirements.filled, true);
    assert.equal(out.artifact.slots.scale_qps.filled, true);
    assert.equal(out.artifact.slots.latency.filled, true);
    assert.equal(out.artifact.slots.consistency_availability.filled, true);
    assert.equal(gate.isChecklistComplete(out.artifact), true);
  });

  test('without candidateFillTexts, candidate speech alone does not fill slots', () => {
    const plan = {
      ...planAnswer({
        question: 'Design a URL shortener like Bitly.',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
      }),
      answerType: 'system_design_answer',
    };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a URL shortener like Bitly.',
      interviewerTexts: ['Where would you like to start?'],
      // Spoken as candidate mic only — not opted into fill.
      candidateTexts: [
        'Functional requirements: create short links and redirect. Scale 100k QPS, latency under 100ms p99, prefer availability.',
      ],
    });
    assert.ok(out.artifact);
    assert.equal(out.artifact.slots.scale_qps.filled, false);
    assert.equal(gate.isChecklistComplete(out.artifact), false);
  });

  test('checklist complete + candidate advance closes gate → post_requirements', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    let artifact = gate.createEmptyRequirementsArtifact('url shortener');
    artifact = gate.fillSlotFromInterviewer(artifact, 'functional_requirements', 'create short links');
    artifact = gate.fillSlotFromInterviewer(artifact, 'scale_qps', '100k QPS');
    artifact = gate.fillSlotFromInterviewer(artifact, 'latency', '100ms');
    artifact = gate.fillSlotFromInterviewer(artifact, 'consistency_availability', 'prefer availability');

    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: 'url shortener',
      interviewerTexts: [],
      candidateTexts: ["let's move on to design"],
    });
    assert.equal(out.softRefuseSpoken, null);
    assert.equal(out.sdPhase, 'post_requirements');
    assert.equal(out.answerPlan.sdPhase, 'post_requirements');
    assert.equal(out.artifact.gateClosed, true);
  });

  test('premature advance soft-refuses and stays requirements', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    const artifact = gate.createEmptyRequirementsArtifact('url shortener');
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: 'url shortener',
      interviewerTexts: ['Functional requirements: create short links and redirect'],
      candidateTexts: ["let's move on"],
    });
    assert.ok(out.softRefuseSpoken);
    assert.match(out.softRefuseSpoken, /scale|qps|latency|consistency|availability/i);
    assert.equal(out.sdPhase, 'requirements');
    assert.equal(out.artifact.gateClosed, false);
  });

  test('uiAdvance soft-refuses without speech phrase (ticket 17)', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    const artifact = gate.createEmptyRequirementsArtifact('url shortener');
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: 'url shortener',
      interviewerTexts: [],
      uiAdvance: true,
    });
    assert.ok(out.softRefuseSpoken);
    assert.equal(out.sdPhase, 'requirements');
    assert.equal(out.artifact.gateClosed, false);
    const vm = gate.projectGateStatusViewModel(out.artifact, { softRefused: true });
    assert.equal(vm.visible, true);
    assert.equal(vm.shouldAutoExpand, true);
  });

  test('uiAdvance accepts when checklist complete (ticket 17)', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    let artifact = gate.createEmptyRequirementsArtifact('url shortener');
    for (const id of ['functional_requirements', 'scale_qps', 'latency', 'consistency_availability']) {
      artifact = gate.fillSlotFromInterviewer(artifact, id, 'x');
    }
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: 'url shortener',
      interviewerTexts: [],
      uiAdvance: true,
    });
    assert.equal(out.softRefuseSpoken, null);
    assert.equal(out.sdPhase, 'post_requirements');
    assert.equal(out.artifact.gateClosed, true);
    assert.equal(gate.projectGateStatusViewModel(out.artifact).visible, false);
  });

  test('new SD problem resets prior gate-closed state', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    let artifact = gate.createEmptyRequirementsArtifact('problem a');
    artifact = gate.fillSlotFromInterviewer(artifact, 'functional_requirements', 'fr');
    artifact = gate.fillSlotFromInterviewer(artifact, 'scale_qps', '1k');
    artifact = gate.fillSlotFromInterviewer(artifact, 'latency', '50ms');
    artifact = gate.fillSlotFromInterviewer(artifact, 'consistency_availability', 'availability');
    artifact = gate.acceptAdvance(artifact);
    assert.equal(gate.deriveSdPhase(artifact), 'post_requirements');

    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: 'Design a rate limiter',
      interviewerTexts: [],
    });
    assert.equal(out.sdPhase, 'requirements');
    assert.equal(out.artifact.gateClosed, false);
    assert.equal(out.artifact.slots.functional_requirements.filled, false);
  });

  test('pipeline signal escalates class and requires data_flow_stages', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a clickstream analytics pipeline',
      interviewerTexts: [
        'Functional requirements: ingest clicks and produce dashboards',
        'Scale 50k events/sec',
        'latency under 2s',
        'prefer availability',
      ],
      candidateTexts: ["let's move on"],
    });
    assert.equal(out.artifact.problemClass, 'data_pipeline_streaming_analytics');
    assert.ok(out.softRefuseSpoken);
    assert.match(out.softRefuseSpoken, /data-flow|data flow/i);
    assert.equal(out.sdPhase, 'requirements');
  });

  test('screen_context fills empty slots after interviewer speech (whiteboard NFRs)', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a URL shortener',
      interviewerTexts: ['Functional: create short links and redirect'],
      screenTexts: ['p99 < 200ms', '100k QPS', 'prefer availability over consistency'],
    });
    assert.equal(out.artifact.slots.functional_requirements.filled, true);
    assert.equal(out.artifact.slots.latency.filled, true);
    assert.equal(out.artifact.slots.scale_qps.filled, true);
    assert.equal(out.artifact.slots.consistency_availability.filled, true);
    assert.ok(out.fills.some((f) => f.id === 'latency'));
  });

  test('interviewer speech wins over conflicting screen text for already-filled slots', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    const out = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'url shortener',
      interviewerTexts: ['Scale about 1k QPS'],
      screenTexts: ['100k QPS'],
    });
    assert.equal(out.artifact.slots.scale_qps.filled, true);
    assert.match(String(out.artifact.slots.scale_qps.value), /1k/i);
  });

  test('ASR-ish advance phrases still soft-refuse when checklist incomplete', () => {
    const plan = { answerType: 'system_design_answer', forbiddenContextLayers: [] };
    for (const phrase of ['lets move on', 'can we move on', "I'm ready to design", 'jump into HLD']) {
      const out = live.prepareSdRequirementsForAnswerPlan({
        answerPlan: plan,
        artifact: gate.createEmptyRequirementsArtifact('p'),
        problemQuestion: 'url shortener',
        interviewerTexts: [],
        candidateTexts: [phrase],
      });
      assert.ok(out.softRefuseSpoken, `expected soft-refuse for: ${phrase}`);
      assert.equal(out.sdPhase, 'requirements');
    }
  });
});

describe('SessionTracker SD Requirements working copy', () => {
  test('get/set/clear and reset clears live state', () => {
    const session = new SessionTracker();
    const a = gate.createEmptyRequirementsArtifact('p');
    session.setSdRequirementsArtifact(a);
    const stored = session.getSdRequirementsArtifact();
    assert.ok(stored);
    assert.equal(stored.problemKey, 'p');
    // Deep-dive siblings defaulted on set for legacy gate-only artifacts.
    assert.ok(stored.designSheet);
    assert.ok(stored.recentSdAnswers);

    session.clearSdRequirementsLive();
    assert.equal(session.getSdRequirementsArtifact(), null);

    session.setSdRequirementsArtifact(a);
    session.reset();
    assert.equal(session.getSdRequirementsArtifact(), null);
  });

  test('mode clearSessionContext does not clear Requirements artifact', () => {
    const session = new SessionTracker();
    const a = gate.createEmptyRequirementsArtifact('p');
    session.setSdRequirementsArtifact(a);
    session.clearSessionContext();
    assert.equal(session.getSdRequirementsArtifact()?.problemKey, 'p');
  });

  test('bindSdRequirementsMeeting hydrates same meeting only', () => {
    const session = new SessionTracker();
    const a = gate.createEmptyRequirementsArtifact('meet-a');
    a.slots.scale_qps.filled = true;

    session.bindSdRequirementsMeeting('meeting-a', () => a);
    assert.equal(session.getSdRequirementsArtifact()?.slots.scale_qps.filled, true);

    session.bindSdRequirementsMeeting('meeting-b', () => null);
    assert.equal(session.getSdRequirementsArtifact(), null);

    // New meeting must not receive meeting-a's checkpoint via wrong loader
    session.bindSdRequirementsMeeting('meeting-c', () => a);
    assert.equal(session.getSdRequirementsArtifact()?.problemKey, 'meet-a');
  });
});

describe('Meeting DB checkpoint roundtrip', () => {
  let DatabaseManager;
  let dbMgr;
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-req-ckpt-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch { /* */ }
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch { /* */ }
    try { delete require.cache[DB_PATH]; } catch { /* */ }
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  });

  test('save → get roundtrip for same meeting id', (t) => {
    if (!dbMgr.isAvailable()) {
      t.skip('better-sqlite3 unavailable under host Node ABI — run under ELECTRON_RUN_AS_NODE=1');
      return;
    }
    const meetingId = 'ckpt-meet-1';
    let artifact = gate.createEmptyRequirementsArtifact('url');
    artifact = gate.fillSlotFromInterviewer(artifact, 'scale_qps', '10k QPS');
    dbMgr.saveSdRequirementsCheckpoint(meetingId, artifact);
    const loaded = dbMgr.getSdRequirementsCheckpoint(meetingId);
    assert.ok(loaded);
    assert.equal(loaded.slots.scale_qps.filled, true);
    assert.equal(loaded.slots.scale_qps.value, '10k QPS');
  });

  test('different meeting id does not return other checkpoint', (t) => {
    if (!dbMgr.isAvailable()) {
      t.skip('better-sqlite3 unavailable under host Node ABI — run under ELECTRON_RUN_AS_NODE=1');
      return;
    }
    dbMgr.saveSdRequirementsCheckpoint('meet-1', gate.createEmptyRequirementsArtifact('a'));
    assert.equal(dbMgr.getSdRequirementsCheckpoint('meet-2'), null);
  });

  test('SessionTracker restore from DB then clear-live leaves DB history', (t) => {
    if (!dbMgr.isAvailable()) {
      t.skip('better-sqlite3 unavailable under host Node ABI — run under ELECTRON_RUN_AS_NODE=1');
      return;
    }
    const meetingId = 'ckpt-meet-2';
    let artifact = gate.createEmptyRequirementsArtifact('pipe');
    artifact = gate.setProblemClass(artifact, 'data_pipeline_streaming_analytics');
    dbMgr.saveSdRequirementsCheckpoint(meetingId, artifact);

    const session = new SessionTracker();
    session.bindSdRequirementsMeeting(meetingId, () => dbMgr.getSdRequirementsCheckpoint(meetingId));
    assert.equal(session.getSdRequirementsArtifact()?.problemClass, 'data_pipeline_streaming_analytics');

    session.clearSdRequirementsLive();
    assert.equal(session.getSdRequirementsArtifact(), null);
    // History retained
    assert.equal(dbMgr.getSdRequirementsCheckpoint(meetingId)?.problemClass, 'data_pipeline_streaming_analytics');

    // New meeting does not hydrate old checkpoint
    session.bindSdRequirementsMeeting('brand-new', () => dbMgr.getSdRequirementsCheckpoint('brand-new'));
    assert.equal(session.getSdRequirementsArtifact(), null);
  });
});

describe('WhatToAnswerLLM gate activates when live prepare stamps sdPhase', () => {
  test('leaking Core Entities is soft-truncated while prepared phase is requirements', async () => {
    const plan = {
      ...planAnswer({
        question: 'Design a URL shortener',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
      }),
      answerType: 'system_design_answer',
    };
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: 'Design a URL shortener',
      interviewerTexts: ['Functional requirements: create short links and redirect'],
    });
    assert.equal(prepared.answerPlan.sdPhase, 'requirements');

    const leak = [
      'Clarifying: what QPS should we hit?',
      '## Core Entities',
      'URL, User, Click',
      '## Deep Dives',
      'Base62 tradeoffs',
    ].join('\n');

    const wta = new WhatToAnswerLLM(makeStubHelper([], leak), stubModes);
    const spoken = await collectStream(
      wta.generateStream(
        '[INTERVIEWER]: Design a URL shortener.',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        prepared.answerPlan,
      ),
    );
    assert.match(spoken, /Clarifying: what QPS/);
    assert.doesNotMatch(spoken, /Core Entities/i);
    assert.doesNotMatch(spoken, /Deep Dives?/i);
  });
});
