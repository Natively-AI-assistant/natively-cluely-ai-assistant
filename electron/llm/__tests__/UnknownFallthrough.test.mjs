// electron/llm/__tests__/UnknownFallthrough.test.mjs
// Issue 8: unknown_answer fallthroughs must be rare (<5 on the 300 dataset). Bare
// follow-up fragments route to a concrete candidate type when they carry signal
// (a named skill / work noun / voice-control directive — release 2026-06-06
// Issues 4/5/6/7); only TRULY context-free fragments ("what about data?") stay on
// the follow_up floor. "confidence" → skill. Whatever the concrete type, NONE of
// these is ever unknown_answer (the property this suite guards).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);
const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

describe('Issue 8: bare follow-ups and control directives are not unknown', () => {
  for (const [q, expected] of [
    // Pure-signal-less fragments stay on the follow_up floor (resolved live).
    ['Why?', 'follow_up_answer'], ['How so?', 'follow_up_answer'],
    ['What about data?', 'follow_up_answer'],
    // Signal-bearing fragments now resolve to a concrete type even standalone
    // (release 2026-06-06): a named skill / work noun → skill_experience;
    // voice/evidence-control directives → a candidate answer by embedded cue.
    ['And what about SQL?', 'skill_experience_answer'],
    ['Hmm right, and Python?', 'skill_experience_answer'],
    ['What about stakeholders?', 'skill_experience_answer'],
    ['Answer like a candidate, not like an assistant.', 'experience_answer'],
    ['Say what I should say, but in my voice.', 'experience_answer'],
    ['If no metric is there, answer without fake metric.', 'project_answer'],
    ['Make it sound confident but don\'t lie.', 'jd_fit_answer'],
    ['What is your confidence?', 'skill_experience_answer'],
    ['How do you compare with competitors?', 'sales_answer'],
    ['Compare your product to competitors.', 'sales_answer'],
  ]) {
    test(`"${q}" → ${expected} (not unknown)`, () => {
      const a = plan(q).answerType;
      assert.notEqual(a, 'unknown_answer', `${q} → unknown`);
      assert.equal(a, expected, `${q} → ${a}`);
    });
  }
});

describe('Issue 8: real standalone questions are NOT mis-captured as follow-ups', () => {
  for (const [q, expected] of [
    ['Why do you want this job?', 'jd_fit_answer'],
    ['Why should we hire you?', 'jd_fit_answer'],
    ['What is time complexity?', 'technical_concept_answer'],
    ['What about your experience with data pipelines in production?', 'skill_experience_answer'],
  ]) {
    test(`"${q}" → ${expected}`, () => assert.equal(plan(q).answerType, expected));
  }
});
