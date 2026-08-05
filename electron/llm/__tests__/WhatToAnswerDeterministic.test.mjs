// electron/llm/__tests__/WhatToAnswerDeterministic.test.mjs
//
// Provider-free unit coverage for the DETERMINISTIC evidence-selection builders
// that are the what-to-answer safety net (test-engineer review 2026-06-05,
// Gaps 1-3): the intro route, the fast-path list routes, and the Issue-7 direct
// profile routes. Since the Full-JIT policy (2026-07-07/08, commit 6e6189b4),
// `tryBuildManualProfileFastPathAnswer` (an alias of `selectManualProfileEvidence`)
// only SELECTS structured evidence for a downstream JIT prompt — it no longer
// renders a final `.answer` string, and `buildLiveFallbackAnswer` is a permanent
// stub that always returns null (provider failures must not fall back to canned
// profile prose). These tests assert against that current evidence-selection
// shape instead of the old rendered-string contract.

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

const fp = (q, profile = PROFILE, jd = null) =>
  tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: jd, source: 'what_to_answer' });

// ── Gap 2: intro route (identity_answer evidence selection) ──────────────────
describe('WTA intro: deterministic identity_answer evidence, never a rendered assistant identity', () => {
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
    test(`"${q}" → grounded identity_answer evidence selection`, () => {
      const r = fp(q);
      assert.ok(r, `expected an evidence selection for "${q}"`);
      assert.equal(r.answerType, 'identity_answer');
      assert.equal(r.answerShape, 'identity_answer');
      assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
      assert.equal(r.usedDeterministicFastPath, false);
      assert.equal(r.finalGenerationMode, 'jit_llm');
      assert.equal(r.profileFactsReady, true);
      assert.ok(r.items.some((f) => f.field === 'identity.name' && f.value === 'Test Candidate'));
      assert.ok(r.selectedContextLayers.includes('stable_identity'));
      assert.ok(r.excludedContextLayers.includes('assistant_identity'), 'must exclude the assistant-identity layer');
      assert.deepEqual(r.selectedExperiences, [
        { company: 'Acme Robotics', role: 'AI & Full Stack Engineer Intern' },
        { company: 'Beta Labs', role: 'Software Engineer Intern' },
      ]);
    });
  }

  test('intro omits the identity.name fact (but still selects evidence) when no name is loaded', () => {
    const noName = { ...PROFILE, identity: {}, name: undefined };
    const r = fp('Tell me about yourself.', noName);
    assert.ok(r, 'evidence selection must still proceed from experience/projects/skills');
    assert.equal(r.answerType, 'identity_answer');
    assert.ok(!r.items.some((f) => f.field === 'identity.name'), 'must not fabricate a name fact');
    assert.deepEqual(r.selectedEntities, []);
  });

  test('manual mode selects the SAME deterministic identity_answer evidence (2026-06-06b)', () => {
    // Release 2026-06-06b: the real manual-chat log showed plain "introduce
    // yourself" / "introduce yourseld" reaching the LLM and answering "I'm
    // Natively, an AI assistant". With a profile loaded, manual intro now routes
    // through the same deterministic evidence selection as WTA — the JIT prompt
    // builder downstream can never be handed the assistant identity instead.
    for (const q of ['Tell me about yourself.', 'introduce yourself', 'introduce yourseld', 'hey man introduce yourself']) {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, jobDescription: null, source: 'manual_input' });
      assert.ok(r, `manual "${q}" should fast-path to deterministic evidence selection`);
      assert.equal(r.answerType, 'identity_answer', `manual "${q}" must select identity_answer evidence`);
      assert.ok(r.excludedContextLayers.includes('assistant_identity'), `manual "${q}" must exclude assistant identity`);
    }
  });
});

// ── Gap 3: fast-path list routes (evidence selection, not rendered strings) ──
describe('WTA fast-path: list-route evidence selection', () => {
  test('"What is your name?" → identity_answer with only the name fact', () => {
    const r = fp('What is your name?');
    assert.equal(r.answerType, 'identity_answer');
    assert.deepEqual(r.selectedEntities, ['Test Candidate']);
    assert.deepEqual(r.sourceRefs, ['identity:name']);
    assert.ok(r.items.every((f) => f.field === 'identity.name'));
  });

  test('"What projects have you done?" → project_answer with both projects', () => {
    const r = fp('What projects have you done?');
    assert.equal(r.answerType, 'project_answer');
    assert.equal(r.answerShape, 'project_answer');
    assert.deepEqual(r.selectedProjects, PROFILE.projects);
    assert.deepEqual(r.sourceRefs, ['project:Flagship', 'project:SidePro']);
  });

  test('"What are your skills?" → skills_answer with the full skill list', () => {
    const r = fp('What are your skills?');
    assert.equal(r.answerType, 'skills_answer');
    assert.deepEqual(r.selectedSkills, ['Python', 'SQL', 'TypeScript', 'React']);
    assert.deepEqual(r.sourceRefs, ['skills']);
  });

  test('"What is your work experience?" → experience_answer with both roles', () => {
    const r = fp('What is your work experience?');
    assert.equal(r.answerType, 'experience_answer');
    assert.deepEqual(r.selectedExperiences, PROFILE.experience);
    assert.deepEqual(r.sourceRefs, ['experience:Acme Robotics', 'experience:Beta Labs']);
  });

  test('JD-fit questions defer to the LLM (no deterministic fast path)', () => {
    const r = fp('Why are you a good fit for this role?', PROFILE, JD);
    assert.equal(r, null, 'jd_fit questions must not fast-path deterministically');
  });
});

// ── Gap 1: buildLiveFallbackAnswer is a permanent Full-JIT-policy stub ───────
describe('buildLiveFallbackAnswer: Full-JIT policy — always defers, never renders canned prose', () => {
  const callFb = (answerType, profile = PROFILE) =>
    buildLiveFallbackAnswer({ question: 'anything', answerType, profile, jobDescription: JD });

  test('returns null for every answer type, profile-backed or not (2026-07-07 Full-JIT policy)', () => {
    for (const at of ['coding_question_answer', 'identity_answer', 'profile_fact_answer', 'project_answer',
      'skills_answer', 'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer']) {
      assert.equal(callFb(at), null, `${at} must never fall back to canned profile prose`);
    }
  });

  test('returns null when no profile is loaded', () => {
    assert.equal(callFb('jd_fit_answer', {}), null);
    assert.equal(callFb('identity_answer', null), null);
  });
});

// Issue 7: expanded deterministic evidence-selection coverage for direct questions.
describe('Issue 7: direct-profile fast paths (instant, grounded evidence selection)', () => {
  const profile = {
    identity: { name: 'Test Candidate' },
    experience: [{ company: 'Acme', role: 'Engineer' }],
    projects: [{ name: 'Proj1', technologies: ['SQL', 'React'] }],
    skills_flat: ['Python', 'SQL', 'React', 'TypeScript'],
    education: [{ institution: 'Test University', degree: 'BTech CSE' }],
  };
  const fp = (q) => tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: { title: 'Data Analyst' }, source: 'manual_input' });

  test('"What do you currently do?" → experience_answer (Acme/Engineer)', () => {
    const r = fp('What do you currently do?');
    assert.equal(r.answerType, 'experience_answer');
    assert.deepEqual(r.selectedExperiences, [{ company: 'Acme', role: 'Engineer' }]);
    assert.deepEqual(r.sourceRefs, ['experience:Acme']);
  });

  test('"What companies have you worked with?" → same experience_answer evidence', () => {
    const r = fp('What companies have you worked with?');
    assert.equal(r.answerType, 'experience_answer');
    assert.deepEqual(r.selectedExperiences, [{ company: 'Acme', role: 'Engineer' }]);
  });

  test('"What programming languages do you know?" defers to the LLM (no structured .skills.languages)', () => {
    // ASKS_SPECIFICALLY_ABOUT_LANGUAGES_RE matches and requires profile.skills.languages;
    // this fixture only has skills_flat, so it must defer rather than fabricate.
    const r = fp('What programming languages do you know?');
    assert.equal(r, null);
  });

  test('"What are your main skills?" → skills_answer preserving skills_flat order', () => {
    const r = fp('What are your main skills?');
    assert.equal(r.answerType, 'skills_answer');
    assert.deepEqual(r.selectedSkills, ['Python', 'SQL', 'React', 'TypeScript']);
  });

  test('"Where did you study?" → profile_fact_answer with education evidence', () => {
    const r = fp('Where did you study?');
    assert.equal(r.answerType, 'profile_fact_answer');
    assert.deepEqual(r.selectedEducation, [{ institution: 'Test University', degree: 'BTech CSE' }]);
    assert.deepEqual(r.sourceRefs, ['education:Test University']);
  });

  test('"What is your educational background?" → same profile_fact_answer education evidence', () => {
    const r = fp('What is your educational background?');
    assert.equal(r.answerType, 'profile_fact_answer');
    assert.deepEqual(r.selectedEducation, [{ institution: 'Test University', degree: 'BTech CSE' }]);
  });

  test('"What is your experience with SQL?" → skill_experience_answer, GROUNDED to the project that uses it', () => {
    const r = fp('What is your experience with SQL?');
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.deepEqual(r.selectedSkills, ['SQL']);
    assert.ok(r.items.some((f) => f.field === 'skill.projects' && f.value.includes('Proj1')), 'must name the grounding project');
    assert.deepEqual(r.sourceRefs, ['skill:SQL', 'project:Proj1']);
  });

  test('a skill NOT in the profile defers to the LLM (no hallucination)', () => {
    const r = fp('What is your experience with Kubernetes?');
    assert.equal(r, null, 'must not fabricate experience with an absent skill');
  });
});
