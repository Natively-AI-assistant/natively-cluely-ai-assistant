// electron/llm/__tests__/SimPostRequirementsAnswerStripTier0.test.mjs
//
// Regression for diagnosing-bugs SPEC 15 live miss:
// clarifier turns plan as general_meeting_answer → gate prepare early-returns →
// WTA never strips → Requirements Draft survives.
//
// IE-level strip must clear drafts when sdProblemKey is pinned and the session
// artifact is already post_requirements — independent of answerType.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SimPostRequirementsAnswerStripTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');
const draftFixture = path.resolve(
  __dirname,
  '../../../.scratch/sd-interview-sim/debug/smoke-turn31-draft.txt',
);

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distLlm, 'AnswerPlanner.js')).href);

const DRAFT_RE = /Requirements Draft:/i;
const draftText = fs.readFileSync(draftFixture, 'utf8');

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

describe('applySimPostRequirementsAnswerStrip (SPEC 15 live miss)', () => {
  test('planner clarifier is general_meeting_answer (load-bearing for the bug)', () => {
    const planned = planAnswer({
      question: 'For analytics, total clicks only or geo/device?',
      source: 'what_to_answer',
      activeMode: { templateType: 'technical-interview', name: 'SD Interview Sim T2' },
    });
    assert.equal(planned.answerType, 'general_meeting_answer');
  });

  test('prepare early-returns without sdPhase for non-SD answerType', () => {
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

  test('IE-level strip clears smoke draft when pinned + closed artifact', () => {
    assert.match(draftText, DRAFT_RE);
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      artifact: closedArtifact(),
    });
    assert.doesNotMatch(out, DRAFT_RE);
    assert.match(out, /aligned on the scope of the analytics/i);
  });

  test('identity without sdProblemKey (product path)', () => {
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      artifact: closedArtifact(),
    });
    assert.equal(out, draftText);
  });

  test('identity while gate still open', () => {
    const open = gate.createEmptyRequirementsArtifact('Design a URL shortener like Bitly.');
    const out = live.applySimPostRequirementsAnswerStrip(draftText, {
      sdProblemKey: 'Design a URL shortener like Bitly.',
      artifact: open,
    });
    assert.equal(out, draftText);
  });
});
