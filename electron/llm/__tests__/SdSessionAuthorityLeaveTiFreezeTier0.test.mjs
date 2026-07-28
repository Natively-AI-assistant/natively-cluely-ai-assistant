// electron/llm/__tests__/SdSessionAuthorityLeaveTiFreezeTier0.test.mjs
//
// Ticket 05 — Leave Technical Interview: authority inert immediately while
// freezing the meeting Requirements working copy (not clearing it). Re-enter
// TI resumes sticky problemKey; meeting-end clear and new-SD-problem reset
// stay as today.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdSessionAuthorityLeaveTiFreezeTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distElectron = path.resolve(__dirname, '../../../dist-electron/electron');
const distLlm = path.join(distElectron, 'llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const authority = await import(pathToFileURL(path.join(distLlm, 'sdSessionAuthority.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);
const { SessionTracker } = await import(pathToFileURL(path.join(distElectron, 'SessionTracker.js')).href);

const TI = 'technical-interview';
const NON_TI = 'behavioral';
const PROBLEM = 'Design a URL shortener like Bitly.';
const PROBLEM_B = 'Design a rate limiter for an API gateway.';

function openFilledArtifact() {
  let a = gate.createEmptyRequirementsArtifact(PROBLEM);
  a = gate.fillSlotFromInterviewer(a, 'scale_qps', '100k QPS');
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

describe('Leave TI freezes Requirements artifact + disarms authority', () => {
  test('leave TI → shouldArmGate false immediately; artifact retained (frozen)', () => {
    const session = new SessionTracker();
    const prior = openFilledArtifact();
    session.setSdRequirementsArtifact(prior);

    const armed = authority.deriveSdSessionAuthority({
      artifact: session.getSdRequirementsArtifact(),
      modeId: TI,
    });
    assert.equal(armed.sessionOpen, true);
    assert.equal(armed.shouldArmGate, true);
    assert.equal(armed.problemKey, PROBLEM);

    // modes:set-active path: clearSessionContext then switch mode (non-TI).
    session.clearSessionContext();
    const frozen = session.getSdRequirementsArtifact();
    assert.ok(frozen, 'live Requirements artifact must be retained on leave TI');
    assert.equal(frozen.problemKey, PROBLEM);
    assert.equal(frozen.slots.scale_qps.filled, true);
    assert.match(String(frozen.slots.scale_qps.value), /100k/i);

    const afterLeave = authority.deriveSdSessionAuthority({
      artifact: frozen,
      modeId: NON_TI,
    });
    assert.equal(afterLeave.sessionOpen, true, 'sticky key still present (session open)');
    assert.equal(afterLeave.shouldArmGate, false, 'gate disarmed outside TI');
    assert.equal(afterLeave.problemKey, PROBLEM);

    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: gmPlan(),
      artifact: frozen,
      problemQuestion: 'For analytics, total clicks only or geo/device?',
      interviewerTexts: ['prefer availability over consistency'],
      modeId: NON_TI,
    });
    assert.equal(prepared.sdPhase, undefined);
    assert.equal(prepared.fills.length, 0);
    assert.equal(prepared.artifact?.problemKey, PROBLEM);
    assert.equal(prepared.artifact?.slots.scale_qps.filled, true);
  });

  test('re-enter TI same meeting → sticky problemKey / session open resumes', () => {
    const session = new SessionTracker();
    session.setSdRequirementsArtifact(openFilledArtifact());
    session.clearSessionContext(); // leave TI mid-meeting (freeze)

    const reentered = authority.deriveSdSessionAuthority({
      artifact: session.getSdRequirementsArtifact(),
      modeId: TI,
    });
    assert.equal(reentered.sessionOpen, true);
    assert.equal(reentered.shouldArmGate, true);
    assert.equal(reentered.problemKey, PROBLEM);
    assert.equal(reentered.sdPhase, 'requirements');

    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: gmPlan(),
      artifact: session.getSdRequirementsArtifact(),
      problemQuestion: 'For analytics, total clicks only or geo/device?',
      interviewerTexts: ['prefer availability over consistency'],
      modeId: TI,
    });
    assert.equal(prepared.sdPhase, 'requirements');
    assert.equal(prepared.artifact.problemKey, PROBLEM);
    assert.equal(prepared.artifact.slots.scale_qps.filled, true);
    assert.ok(
      prepared.fills.length > 0 || prepared.artifact.slots.consistency_availability?.filled,
      'prepare resumes under sticky key after re-enter TI',
    );
  });

  test('meeting end still clears live working copy', () => {
    const session = new SessionTracker();
    session.setSdRequirementsArtifact(openFilledArtifact());
    session.clearSessionContext();
    assert.equal(session.getSdRequirementsArtifact()?.problemKey, PROBLEM);

    session.clearMeetingMetadata();
    assert.equal(session.getSdRequirementsArtifact(), null);

    const afterEnd = authority.deriveSdSessionAuthority({
      artifact: session.getSdRequirementsArtifact(),
      modeId: TI,
    });
    assert.equal(afterEnd.sessionOpen, false);
    assert.equal(afterEnd.shouldArmGate, false);
  });

  test('new-SD-problem reset still replaces identity and re-opens the gate', () => {
    let artifact = gate.createEmptyRequirementsArtifact(PROBLEM);
    for (const id of [
      'functional_requirements',
      'scale_qps',
      'latency',
      'consistency_availability',
    ]) {
      artifact = gate.fillSlotFromInterviewer(artifact, id, 'filled');
    }
    artifact = gate.acceptAdvance(artifact);
    assert.equal(gate.deriveSdPhase(artifact), 'post_requirements');

    const plan = {
      answerType: 'system_design_answer',
      forbiddenContextLayers: [],
    };
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: plan,
      artifact,
      problemQuestion: PROBLEM_B,
      interviewerTexts: ['Scale about 10k QPS'],
      modeId: TI,
    });
    assert.ok(prepared.artifact?.problemKey);
    assert.notEqual(prepared.artifact.problemKey, PROBLEM);
    assert.equal(prepared.sdPhase, 'requirements');
    assert.equal(prepared.artifact.gateClosed, false);
    assert.equal(prepared.artifact.slots.scale_qps.filled, true);

    const auth = authority.deriveSdSessionAuthority({
      artifact: prepared.artifact,
      modeId: TI,
    });
    assert.equal(auth.sessionOpen, true);
    assert.equal(auth.shouldArmGate, true);
    assert.equal(auth.problemKey, prepared.artifact.problemKey);
  });
});
