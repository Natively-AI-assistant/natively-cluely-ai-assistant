// electron/llm/__tests__/SimPostRequirementsAnswerStripTier0.test.mjs
//
// SdSessionAuthority ticket 03 / SPEC 15–17 product generalization:
// once an SD session is open (sticky problemKey on the artifact), late
// Requirements Draft restatements are stripped when phase is post_requirements
// OR checklist is complete — without requiring sdProblemKey pin.
// Pin remains an optional sim seed adapter for early sticky identity.
// Soft post-requirements nudge stays sim-only (tested elsewhere).
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SimPostRequirementsAnswerStripTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

const DRAFT_RE = /Requirements Draft:/i;
// Inline smoke-turn31 draft (was .scratch/.../smoke-turn31-draft.txt; untracked).
const draftText = [
  'That makes sense. To make sure we\'re aligned on the scope of the analytics,',
  'are we tracking just the total click count per link, or do we need to support',
  'granular, time-series data like geographic location, device type, and referral',
  'source for every click?',
  '',
  '**Requirements Draft:**',
  '*   **Functional:**',
  '*   Shorten long URLs into unique, short aliases.',
  '*   **Non-Functional:**',
  '*   High availability (redirects must always work).',
].join('\n');

function closedArtifact() {
  let a = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
  for (const id of [
    'functional_requirements',
    'scale_qps',
    'latency',
    'consistency_availability',
  ]) {
    a = gate.fillSlotFromInterviewer(a, id, 'filled');
  }
  return gate.acceptAdvance(a);
}

describe('applySimPostRequirementsAnswerStrip (SPEC 15 live miss / ticket 03)', () => {
  test('planner clarifier is general_meeting_answer (load-bearing for the bug)', () => {
    const planned = planAnswer({
      question: 'For analytics, total clicks only or geo/device?',
      source: 'what_to_answer',
      activeMode: { templateType: 'technical-interview', name: 'SD Interview Sim T2' },
    });
    assert.equal(planned.answerType, 'general_meeting_answer');
  });

  test('prepare under authority stamps sdPhase for GM when TI + sticky key', () => {
    const planned = planAnswer({
      question: 'For analytics, total clicks only or geo/device?',
      source: 'what_to_answer',
      activeMode: { templateType: 'technical-interview' },
    });
    assert.equal(planned.answerType, 'general_meeting_answer');
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: closedArtifact(),
      problemQuestion: 'Design a URL shortener like Bitly.',
      interviewerTexts: ['geo?'],
      modeId: 'technical-interview',
    });
    assert.equal(prepared.sdPhase, 'post_requirements');
    assert.equal(prepared.answerPlan.sdPhase, 'post_requirements');
  });

  test('prepare stays inert for GM without modeId even when artifact is closed', () => {
    const planned = planAnswer({
      question: 'For analytics, total clicks only or geo/device?',
      source: 'what_to_answer',
      activeMode: { templateType: 'technical-interview' },
    });
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: planned,
      artifact: closedArtifact(),
      problemQuestion: 'Design a URL shortener like Bitly.',
      interviewerTexts: ['geo?'],
    });
    assert.equal(prepared.sdPhase, undefined);
    assert.equal(prepared.answerPlan.sdPhase, undefined);
  });

  test('product path: strip clears smoke draft when session open + closed artifact (no pin)', () => {
    assert.match(draftText, DRAFT_RE);
    const artifact = closedArtifact();
    assert.ok(artifact.problemKey);
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact,
      modeId: 'technical-interview',
    });
    assert.doesNotMatch(out, DRAFT_RE);
    assert.match(out, /aligned on the scope of the analytics/i);
  });

  test('leave TI: sticky artifact does not strip (authority inert)', () => {
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: closedArtifact(),
      modeId: 'behavioral',
    });
    assert.equal(out, draftText);
  });

  test('sim pin seed: strip still clears draft when pinned + closed artifact', () => {
    assert.match(draftText, DRAFT_RE);
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      artifact: closedArtifact(),
    });
    assert.doesNotMatch(out, DRAFT_RE);
    assert.match(out, /aligned on the scope of the analytics/i);
  });

  test('identity when session not open (no sticky key, no pin)', () => {
    const orphan = { ...closedArtifact(), problemKey: null };
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: orphan,
      modeId: 'technical-interview',
    });
    assert.equal(out, draftText);
  });

  test('identity while gate still open and checklist incomplete', () => {
    const open = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: open,
      modeId: 'technical-interview',
    });
    assert.equal(out, draftText);
  });

  test('SPEC 17 product: strips when session open + checklist complete even if gate not closed', () => {
    let a = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    for (const id of [
      'functional_requirements',
      'scale_qps',
      'latency',
      'consistency_availability',
    ]) {
      a = gate.fillSlotFromInterviewer(a, id, 'filled');
    }
    assert.equal(gate.isChecklistComplete(a), true);
    assert.equal(gate.deriveSdPhase(a), 'requirements');
    assert.equal(a.gateClosed, false);
    assert.ok(a.problemKey);

    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: a,
      modeId: 'technical-interview',
    });
    assert.doesNotMatch(out, DRAFT_RE);
    assert.match(out, /aligned on the scope of the analytics/i);
  });

  test('strips on core FR/NFR complete even when pipeline class awaits data_flow', () => {
    let a = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    a = gate.setProblemClass(a, 'data_pipeline_streaming_analytics');
    for (const id of [
      'functional_requirements',
      'scale_qps',
      'latency',
      'consistency_availability',
    ]) {
      a = gate.fillSlotFromInterviewer(a, id, 'filled');
    }
    assert.equal(gate.isCoreRequirementsComplete(a), true);
    assert.equal(gate.isChecklistComplete(a), false);
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: a,
      modeId: 'technical-interview',
      sdProblemKey: 'Design a URL shortener like Bitly.',
    });
    assert.doesNotMatch(out, DRAFT_RE);
  });

  test('FULL_RAW Shorten draft fills FR + latency + scale for core complete', () => {
    const blob = `I'll outline the core requirements.

**Functional Requirements:**
*   **Shorten:** Users provide a long URL and get a unique, short alias.
*   **Redirect:** Accessing the short alias redirects to the original long URL.

**Non-Functional Requirements:**
*   **Low Latency:** Redirection needs to be extremely fast, ideally under 100ms.
*   **Scale:** We should support a high read-to-write ratio, likely millions of requests per day.
`;
    let a = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    a = gate.fillSlotFromInterviewer(a, 'consistency_availability', 'availability');
    const { artifact, fills } = live.fillArtifactFromInterviewerText(a, blob);
    const ids = fills.map((f) => f.id).sort();
    assert.deepEqual(ids, ['functional_requirements', 'latency', 'scale_qps'].sort());
    assert.equal(gate.isCoreRequirementsComplete(artifact), true);
  });

  test('SPEC 17 pin seed: strips when pinned + checklist complete even if gate not closed', () => {
    let a = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    for (const id of [
      'functional_requirements',
      'scale_qps',
      'latency',
      'consistency_availability',
    ]) {
      a = gate.fillSlotFromInterviewer(a, id, 'filled');
    }
    assert.equal(gate.isChecklistComplete(a), true);
    assert.equal(a.gateClosed, false);

    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      artifact: a,
    });
    assert.doesNotMatch(out, DRAFT_RE);
    assert.match(out, /aligned on the scope of the analytics/i);
  });

  test('pin without sticky artifact is identity (seed before prepare)', () => {
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      artifact: null,
    });
    assert.equal(out, draftText);
  });

  test('soft nudge remains pin-gated (product path identity)', () => {
    const nudged = live.appendSimPostRequirementsNudge('Continue deep dive.', {
      sdPhase: 'post_requirements',
    });
    assert.equal(nudged, 'Continue deep dive.');
    const sim = live.appendSimPostRequirementsNudge('Continue deep dive.', {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      sdPhase: 'post_requirements',
    });
    assert.match(sim, /Requirements for this problem are already locked/);
  });
});
