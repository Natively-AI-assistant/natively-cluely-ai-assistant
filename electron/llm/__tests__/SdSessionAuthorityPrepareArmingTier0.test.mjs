// electron/llm/__tests__/SdSessionAuthorityPrepareArmingTier0.test.mjs
//
// Ticket 01 — SdSessionAuthority: TI + sticky problemKey arms prepare on
// general_meeting_answer clarifiers; no key / non-TI stay inert; clarifier
// alone never opens a session; system_design_answer still establishes sticky key.
// Ticket 04 — overlay publish/hide follows shouldArmGate (not answerType).
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdSessionAuthorityPrepareArmingTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const authority = await import(pathToFileURL(path.join(distLlm, 'sdSessionAuthority.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

const TI = 'technical-interview';
const PROBLEM = 'Design a URL shortener like Bitly.';

function openArtifact() {
  return gate.createEmptyRequirementsArtifact(PROBLEM);
}

function filledArtifact() {
  let a = openArtifact();
  for (const id of [
    'functional_requirements',
    'scale_qps',
    'latency',
    'consistency_availability',
  ]) {
    a = gate.fillSlotFromInterviewer(a, id, 'filled');
  }
  return a;
}

function gmPlan(question = 'For analytics, total clicks only or geo/device?') {
  const planned = planAnswer({
    question,
    source: 'what_to_answer',
    activeMode: { templateType: TI, name: 'SD Interview Sim T2' },
  });
  assert.equal(planned.answerType, 'general_meeting_answer');
  return planned;
}

describe('deriveSdSessionAuthority', () => {
  test('TI + sticky problemKey → sessionOpen and shouldArmGate', () => {
    const a = openArtifact();
    const out = authority.deriveSdSessionAuthority({ artifact: a, modeId: TI });
    assert.equal(out.sessionOpen, true);
    assert.equal(out.shouldArmGate, true);
    assert.equal(out.sdPhase, 'requirements');
    assert.equal(out.problemKey, PROBLEM);
  });

  test('no problemKey → session closed and gate disarmed', () => {
    const out = authority.deriveSdSessionAuthority({
      artifact: gate.createEmptyRequirementsArtifact(null),
      modeId: TI,
    });
    assert.equal(out.sessionOpen, false);
    assert.equal(out.shouldArmGate, false);
    assert.equal(out.sdPhase, undefined);
    assert.equal(out.problemKey, null);
  });

  test('non-TI with sticky key → sessionOpen but shouldArmGate false', () => {
    const out = authority.deriveSdSessionAuthority({
      artifact: openArtifact(),
      modeId: 'behavioral',
    });
    assert.equal(out.sessionOpen, true);
    assert.equal(out.shouldArmGate, false);
    assert.equal(out.sdPhase, 'requirements');
  });
});

describe('prepareSdRequirementsForAnswerPlan under authority', () => {
  test('TI + open artifact + general_meeting_answer stamps sdPhase and fills', () => {
    const planned = gmPlan();
    const prior = openArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: 'For analytics, total clicks only or geo/device?',
      interviewerTexts: [
        'Functional requirements: create short links and redirect',
        'Scale about 100k QPS',
      ],
      modeId: TI,
    });
    assert.equal(prepared.sdPhase, 'requirements');
    assert.equal(prepared.answerPlan.sdPhase, 'requirements');
    assert.ok(prepared.artifact);
    assert.equal(prepared.artifact.problemKey, PROBLEM);
    assert.equal(prepared.artifact.slots.scale_qps.filled, true);
    assert.equal(prepared.fills.length > 0, true);
  });

  test('TI + open artifact + GM evaluates advance/soft-refuse', () => {
    const planned = gmPlan("let's move on");
    const prior = filledArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: "let's move on to design",
      interviewerTexts: [],
      candidateTexts: ["let's move on to design"],
      modeId: TI,
    });
    assert.equal(prepared.softRefuseSpoken, null);
    assert.equal(prepared.sdPhase, 'post_requirements');
    assert.equal(prepared.artifact.gateClosed, true);
  });

  test('TI + open incomplete artifact + GM soft-refuses premature advance', () => {
    const planned = gmPlan("let's move on");
    const prior = openArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: "let's move on",
      interviewerTexts: ['Functional requirements: create short links and redirect'],
      candidateTexts: ["let's move on"],
      modeId: TI,
    });
    assert.ok(prepared.softRefuseSpoken);
    assert.match(prepared.softRefuseSpoken, /scale|qps|latency|consistency|availability/i);
    assert.equal(prepared.sdPhase, 'requirements');
    assert.equal(prepared.artifact.gateClosed, false);
    assert.equal(prepared.artifact.problemKey, PROBLEM);
  });

  test('no problemKey → prepare stays inert for GM', () => {
    const planned = gmPlan();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: null,
      problemQuestion: 'For analytics, total clicks only or geo/device?',
      interviewerTexts: ['prefer availability'],
      modeId: TI,
    });
    assert.equal(prepared.sdPhase, undefined);
    assert.equal(prepared.answerPlan.sdPhase, undefined);
    assert.equal(prepared.artifact, null);
    assert.equal(prepared.fills.length, 0);
  });

  test('non-TI → prepare stays inert even with sticky key', () => {
    const planned = gmPlan();
    const prior = openArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: 'clarifier',
      interviewerTexts: ['prefer availability'],
      modeId: 'behavioral',
    });
    assert.equal(prepared.sdPhase, undefined);
    assert.equal(prepared.answerPlan.sdPhase, undefined);
    assert.equal(prepared.artifact, prior);
    assert.equal(prepared.fills.length, 0);
  });

  test('clarifier alone never establishes sticky problemKey', () => {
    const planned = gmPlan();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: null,
      problemQuestion: 'Design a URL shortener like Bitly.',
      interviewerTexts: ['Functional requirements: create short links'],
      modeId: TI,
    });
    assert.equal(prepared.artifact, null);
    assert.equal(prepared.sdPhase, undefined);
    const auth = authority.deriveSdSessionAuthority({
      artifact: prepared.artifact,
      modeId: TI,
    });
    assert.equal(auth.sessionOpen, false);
  });

  test('system_design_answer still establishes sticky key', () => {
    const plan = {
      answerType: 'system_design_answer',
      forbiddenContextLayers: [],
    };
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact: null,
      problemQuestion: PROBLEM,
      interviewerTexts: ['Scale about 100k QPS'],
      modeId: TI,
    });
    assert.equal(prepared.sdPhase, 'requirements');
    assert.ok(prepared.artifact?.problemKey);
    assert.equal(prepared.artifact.slots.scale_qps.filled, true);
    const auth = authority.deriveSdSessionAuthority({
      artifact: prepared.artifact,
      modeId: TI,
    });
    assert.equal(auth.sessionOpen, true);
    assert.equal(auth.shouldArmGate, true);
  });

  test('authority GM prepare does not reset sticky key from clarifier question', () => {
    const planned = gmPlan('Would geo breakdown be useful?');
    const prior = filledArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: 'Would geo breakdown be useful?',
      interviewerTexts: [],
      modeId: TI,
    });
    assert.equal(prepared.artifact.problemKey, PROBLEM);
    assert.equal(prepared.sdPhase, 'requirements');
    assert.equal(prepared.artifact.slots.scale_qps.filled, true);
  });
});

// Ticket 04 — overlay publish/hide follows shouldArmGate, not answerType.
describe('overlay under SdSessionAuthority', () => {
  test('TI + open session → overlay shown (GM answerType irrelevant)', () => {
    const planned = gmPlan();
    assert.equal(planned.answerType, 'general_meeting_answer');
    const a = openArtifact();
    assert.equal(
      authority.deriveSdSessionAuthority({ artifact: a, modeId: TI }).shouldArmGate,
      true,
    );
    const vm = authority.projectGateStatusUnderAuthority(a, TI);
    assert.equal(vm.visible, true);
    assert.match(vm.progressLabel, /Requirements/);
  });

  test('after GM prepare under authority, overlay stays shown', () => {
    const planned = gmPlan();
    const prior = openArtifact();
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: prior,
      problemQuestion: 'For analytics, total clicks only or geo/device?',
      interviewerTexts: ['Functional requirements: create short links and redirect'],
      modeId: TI,
    });
    assert.equal(prepared.sdPhase, 'requirements');
    const vm = authority.projectGateStatusUnderAuthority(prepared.artifact, TI);
    assert.equal(vm.visible, true);
    assert.ok(vm.filled >= 1);
  });

  test('non-TI → overlay hidden even with open requirements artifact', () => {
    const a = openArtifact();
    assert.equal(gate.projectGateStatusViewModel(a).visible, true);
    const vm = authority.projectGateStatusUnderAuthority(a, 'behavioral');
    assert.equal(vm.visible, false);
  });

  test('session-closed → overlay hidden even in TI', () => {
    const a = gate.createEmptyRequirementsArtifact(null);
    // Raw projector would show an open gate; authority must keep it inert.
    assert.equal(gate.projectGateStatusViewModel(a).visible, true);
    assert.equal(
      authority.deriveSdSessionAuthority({ artifact: a, modeId: TI }).shouldArmGate,
      false,
    );
    const vm = authority.projectGateStatusUnderAuthority(a, TI);
    assert.equal(vm.visible, false);
  });
});
