// electron/llm/__tests__/WhatToAnswerDeterministic.test.mjs
//
// Provider-free unit coverage for the DETERMINISTIC output builders that are the
// what-to-answer safety net (test-engineer review 2026-06-05, Gaps 1-3): the
// intro builder, the live latency fallback, and the first-person rewrites. These
// run in CI without a provider and catch the exact regressions (dropped .replace
// → second-person voice; missing intro → "I'm Natively" leak; empty fallback →
// blank live answer) that otherwise only the provider-gated benchmark would find.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mpi = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);
const { tryBuildManualProfileFastPathAnswer, buildLiveFallbackAnswer } = mpi;

// Realistic structured profile (no PII beyond a synthetic test fixture).
const PROFILE = {
  identity: { name: 'Test Candidate' },
  experience: [
    { company: 'Acme Robotics', role: 'AI & Full Stack Engineer Intern' },
    { company: 'Beta Labs', role: 'Software Engineer Intern' },
  ],
  projects: [
    { name: 'Flagship', description: 'a privacy-first meeting copilot', technologies: ['Electron', 'TypeScript', 'Rust'] },
    { name: 'SidePro', description: 'an interview platform', technologies: ['React', 'Node'] },
  ],
  skills_flat: ['Python', 'SQL', 'TypeScript', 'React'],
  education: [{ institution: 'Test University', degree: 'BTech CSE' }],
};
const JD = { title: 'Data Analyst', role: 'Data Analyst' };
const NATIVELY = /\b(i am|i'?m)\s+(natively|an? (ai )?assistant|a language model)\b/i;
const SECOND_PERSON = /^(your |you are)\b/i;

const fp = (q, profile = PROFILE, jd = null) =>
  tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: jd, source: 'what_to_answer' });

// ── Gap 2: formatIntro / INTRO branch ────────────────────────────────────────
describe('WTA intro: deterministic first-person, never Natively', () => {
  const introPhrasings = [
    'Tell me about yourself.',
    'Give me a quick introduction.',
    'Can you quickly introduce yourself?',
    'How would you describe yourself professionally?',
    'Describe yourself professionally.',
    'Walk me through your background.',
    'Give me your background.',
    'Can you summarize who you are as a candidate?',
  ];
  for (const q of introPhrasings) {
    test(`"${q}" → grounded first-person intro`, () => {
      const r = fp(q);
      assert.ok(r && r.answer, `expected a deterministic answer for "${q}"`);
      assert.match(r.answer, /^I'm Test Candidate/, 'must open first-person with the name');
      assert.doesNotMatch(r.answer, NATIVELY, 'must not leak Natively/AI-assistant identity');
      assert.doesNotMatch(r.answer, SECOND_PERSON, 'must not be second-person');
      assert.doesNotMatch(r.answer, /\bEvin is\b|\bThe candidate\b/i, 'must not be third-person');
    });
  }
  test('intro returns null (→ LLM) when no name is loaded', () => {
    const noName = { ...PROFILE, identity: {}, name: undefined };
    const r = fp('Tell me about yourself.', noName);
    // formatIntro returns '' → branch yields no route; some other branch may also
    // decline. Either way it must NOT produce a broken "I'm undefined".
    if (r && r.answer) assert.doesNotMatch(r.answer, /undefined|I'm \./);
  });
  test('manual mode NOW uses the deterministic first-person intro (2026-06-06b)', () => {
    // Release 2026-06-06b: the real manual-chat log showed plain "introduce
    // yourself" / "introduce yourseld" reaching the LLM and answering "I'm
    // Natively, an AI assistant". With a profile loaded, manual intro now uses the
    // same deterministic first-person intro as WTA — it can never leak the
    // assistant identity or refuse.
    for (const q of ['Tell me about yourself.', 'introduce yourself', 'introduce yourseld', 'hey man introduce yourself']) {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, jobDescription: null, source: 'manual_input' });
      assert.ok(r && r.answer, `manual "${q}" should fast-path to the deterministic intro`);
      assert.match(r.answer, /^I'm Test Candidate/, `manual "${q}" must be the first-person candidate intro`);
      assert.doesNotMatch(r.answer, NATIVELY, `manual "${q}" must not leak Natively/AI-assistant`);
    }
  });
});

// ── Gap 3: first-person rewrites for what_to_answer ──────────────────────────
describe('WTA fast-path: first-person voice for list routes', () => {
  const cases = [
    ['What is your name?', /^My name is /],
    ['What projects have you done?', /^My projects include /],
    ['What are your skills?', /^My skills include /],
    ['What is your work experience?', /^My experience includes /],
  ];
  for (const [q, re] of cases) {
    test(`"${q}" → first-person`, () => {
      const r = fp(q);
      assert.ok(r && r.answer, `expected answer for "${q}"`);
      assert.match(r.answer, re, `expected first-person form for "${q}", got: ${r && r.answer}`);
      assert.doesNotMatch(r.answer, /^Your /, 'must not be second-person');
    });
  }
  test('JD-fit fast-path is first-person ("I fit", not "You fit")', () => {
    const r = fp('Why are you a good fit for this role?', PROFILE, JD);
    if (r && r.answer) assert.doesNotMatch(r.answer, /^You fit/i);
  });
});

// ── Gap 1: buildLiveFallbackAnswer (the latency safety net) ──────────────────
describe('buildLiveFallbackAnswer: latency fallback contract', () => {
  const callFb = (answerType, profile = PROFILE) =>
    buildLiveFallbackAnswer({ question: 'anything', answerType, profile, jobDescription: JD });

  test('returns null for NON-profile routes (no profile in forbidden surfaces)', () => {
    for (const at of ['coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
      'system_design_answer', 'debugging_question_answer', 'general_meeting_answer',
      'lecture_answer', 'sales_answer', 'negotiation_answer']) {
      assert.equal(callFb(at), null, `${at} must NOT get a profile fallback`);
    }
  });

  test('returns null when no profile is loaded', () => {
    assert.equal(callFb('jd_fit_answer', {}), null);
    assert.equal(callFb('identity_answer', null), null);
  });

  test('returns a NON-EMPTY first-person answer for every profile route', () => {
    for (const at of ['identity_answer', 'profile_fact_answer', 'project_answer',
      'project_followup_answer', 'skills_answer', 'skill_experience_answer',
      'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer']) {
      const a = callFb(at);
      assert.ok(a && a.trim().length > 0, `${at} must yield a non-empty fallback`);
      assert.doesNotMatch(a, NATIVELY, `${at} fallback must not leak Natively`);
      assert.doesNotMatch(a, /^Your |\bYou are\b/i, `${at} fallback must be first-person, got: ${a}`);
    }
  });

  test('behavioral fallback (no fast-path) still produces grounded first-person content', () => {
    const a = callFb('behavioral_interview_answer');
    assert.ok(a && /^I'm |^I /.test(a), `expected first-person, got: ${a}`);
    assert.doesNotMatch(a, /I don't have specific past experience loaded/);
  });
});

// Issue 7: expanded deterministic fast-path coverage for common direct questions.
describe('Issue 7: direct-profile fast paths (instant, grounded)', () => {
  const profile = {
    identity: { name: 'Test Candidate' },
    experience: [{ company: 'Acme', role: 'Engineer' }],
    projects: [{ name: 'Proj1', technologies: ['SQL', 'React'] }],
    skills_flat: ['Python', 'SQL', 'React', 'TypeScript'],
    education: [{ institution: 'Test University', degree: 'BTech CSE' }],
  };
  const fp = (q) => tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: { title: 'Data Analyst' }, source: 'manual_input' });
  const covered = [
    'What do you currently do?', 'What companies have you worked with?',
    'What programming languages do you know?', 'What are your main skills?',
    'Where did you study?', 'What is your educational background?',
    'What is your experience with SQL?',
  ];
  for (const q of covered) {
    test(`"${q}" → deterministic fast-path (no LLM)`, () => {
      const r = fp(q);
      assert.ok(r && r.answer && r.answer.trim().length > 0, `expected a fast-path answer for "${q}"`);
      assert.equal(r.providerUsed, false);
    });
  }
  test('skill-experience fast path is GROUNDED (SQL → names the project that uses it)', () => {
    const r = fp('What is your experience with SQL?');
    assert.match(r.answer, /SQL/i);
    assert.match(r.answer, /Proj1/);
  });
  test('a skill NOT in the profile defers to the LLM (no hallucination)', () => {
    const r = fp('What is your experience with Kubernetes?');
    assert.ok(!r || !r.answer, 'must not fabricate experience with an absent skill');
  });
  test('"educational background" → education (not experience)', () => {
    const r = fp('What is your educational background?');
    assert.match(r.answer, /education|B\.?Tech|Test University/i);
  });
});
