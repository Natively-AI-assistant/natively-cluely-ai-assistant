/**
 * Regression tests for AnswerPlanner routing defects found by the real-backend
 * MiniMax E2E campaign (2026-07-03, docs/investigations/profile-e2e-minimax-*).
 * Deterministic — no live backend needed.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);
const p = (q) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' });

describe('E2E F-ROUTE-1: bare tech keyword must NOT force system-design on an experience probe', () => {
  const experienceProbes = [
    'Roughly how many years have you been working directly on distributed systems?',
    'How many years have you been working with scalable architectures?',
    'Tell me about your experience building scalable services.',
    'How long have you worked on distributed systems?',
  ];
  for (const q of experienceProbes) {
    test(`"${q.slice(0, 45)}…" → candidate experience, required, first person`, () => {
      const r = p(q);
      assert.notEqual(r.answerType, 'system_design_answer', 'must not be system_design');
      assert.equal(r.profileContextPolicy, 'required', 'profile must be grounded');
      assert.equal(r.voicePerspective, 'first_person_candidate', 'first person');
    });
  }

  // A REAL system-design ASK must still route to system_design (no over-correction).
  for (const q of [
    'Design a scalable URL shortener that handles a billion requests.',
    'How would you architect a distributed cache for low latency?',
    'Design a notification system for millions of users.',
  ]) {
    test(`"${q.slice(0, 45)}…" → system_design preserved`, () => {
      assert.equal(p(q).answerType, 'system_design_answer');
    });
  }
});

describe('E2E F-ROUTE-3: "biggest achievement at <Company>" is a candidate behavioral answer', () => {
  for (const q of [
    'What was your biggest achievement at Stripe?',
    'What are you most proud of in your career?',
    'What did you accomplish at Datadog?',
    'Tell me your greatest accomplishment.',
  ]) {
    test(`"${q.slice(0, 40)}…" → candidate voice + profile required (not forbidden)`, () => {
      const r = p(q);
      assert.equal(r.profileContextPolicy, 'required', 'achievement about the candidate must ground in profile');
      assert.equal(r.voicePerspective, 'first_person_candidate', 'first person, not assistant');
      assert.notEqual(r.answerType, 'system_design_answer');
    });
  }

  // "best project" must remain a PROJECT answer (the exclusion that guards this).
  test('"Which is your best project?" stays project_answer (not stolen by achievement pattern)', () => {
    assert.equal(p('Which is your best project?').answerType, 'project_answer');
  });
  test('"Tell me about your best work on the platform" stays project-ish, not achievement', () => {
    // "best work" must NOT be captured by the accomplishment-noun pattern.
    const r = p('Tell me about your best project on the platform.');
    assert.equal(r.answerType, 'project_answer');
  });
});

// Code-review hardening (2026-07-03): two edge cases the reviewer surfaced on the
// campaign's routing changes — both are "narrowing" fixes that must stay fixed.
describe('E2E code-review: identity/self-compound + past-tense skill-experience', () => {
  // MEDIUM 1: "about your self-<compound>" is a technical/project ask, NOT an intro.
  // The `(?![-\w])` lookahead on the "about yourself" intro patterns must hold.
  for (const q of [
    'tell me about your self-attention implementation',
    'tell me about your self-supervised pretraining work',
    'tell me a bit about your self-hosted setup',
  ]) {
    test(`"${q.slice(0, 45)}…" must NOT be identity_answer`, () => {
      assert.notEqual(p(q).answerType, 'identity_answer');
    });
  }
  // The genuine intros must still route to identity (the lookahead must not break them).
  for (const q of [
    'tell me a little about yourself and your background',
    'tell us about yourself',
    'give us a quick self-introduction',
  ]) {
    test(`"${q.slice(0, 45)}…" stays identity_answer`, () => {
      assert.equal(p(q).answerType, 'identity_answer');
    });
  }
  // MEDIUM 2: past-tense "worked" must be caught by SKILL_EXPERIENCE_PATTERNS.
  for (const q of [
    'How long have you worked with Kubernetes?',
    'How many years have you worked on distributed systems?',
    'How long have you been working on ML infrastructure?',
  ]) {
    test(`"${q.slice(0, 45)}…" → skill_experience_answer`, () => {
      assert.equal(p(q).answerType, 'skill_experience_answer');
    });
  }
});
