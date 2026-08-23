// electron/intelligence/__tests__/ProfileTreeDeterministicFastPath2026_06_15.test.mjs
//
// Phase 5 (task 2026-06-15): prove the ProfileTree deterministic fast path for direct
// profile/identity questions — and the App-identity-vs-Candidate-identity split, and the
// first-person experience-count answer (A09). These run against the compiled dist-electron
// artifact, the exact code the live manual path calls via buildManualProfileBackendAnswer.
//
// UPDATED 2026-07-11 (Context OS ownership audit): `tryBuildManualProfileFastPathAnswer`
// (aka `selectManualProfileEvidence`) no longer returns a canned final-prose `answer`
// string. `ManualProfileRouteResult.answer` is now `never` by type (see
// manualProfileIntelligence.ts: "Final profile answers are JIT-only. This is
// intentionally absent.") — the function is a DETERMINISTIC EVIDENCE SELECTOR only;
// every profile question (including name/skills/projects/experience) now always
// generates its final prose via the LLM (finalGenerationMode:'jit_llm',
// providerUsed:true), grounded in the deterministically-selected evidence
// (usedDeterministicEvidenceSelection:true, sourceOwner:'profile',
// checkedSources:['profile_resume']). This test originally asserted the OLD
// canned-string contract (usedDeterministicFastPath:true, providerUsed:false,
// answer:"My experience includes…") which no longer exists — updated to assert the
// CURRENT contract: evidence is profile-scoped, deterministic, and correctly typed,
// while final phrasing is left to JIT generation (still governed by the selected
// evidence, so first-person voice + no-cross-contamination still hold at the LLM
// layer, just not as a literal string match here).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ProfileTreeService } from '../../../dist-electron/electron/intelligence/ProfileTreeService.js';
import {
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
} from '../../../dist-electron/electron/llm/manualProfileIntelligence.js';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [
    { role: 'Software Engineer', company: 'Acme', bullets: ['Built the data pipeline'] },
    { role: 'Data Intern', company: 'Beta' },
  ],
  projects: [{ name: 'Natively', description: 'AI meeting copilot', technologies: ['Electron', 'TypeScript'] }],
  skills: ['Python', 'SQL', 'React'],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'State University' }],
};

describe('ProfileTree deterministic fast path — profile-owned JIT prompt, no fabrication rules', () => {
  const svc = new ProfileTreeService(PROFILE, null);

  // ProfileTreeService.get*() no longer returns literal prose (see the class's own
  // "answer()" docstring: "This service no longer returns deterministic final
  // prose; callers must pass this prompt to a provider"). It returns a structured
  // JIT prompt (<profile_jit_final_answer_request>) that pins source_owner=profile,
  // lists only the candidate's own evidence, and forbids fabricating facts not in
  // that list. These assertions prove the STRUCTURAL guarantee replacing the old
  // literal-string guarantee: it is not possible for this prompt to contain another
  // profile's data or to instruct the model to speak as anyone but the candidate.
  test('name → profile-owned JIT prompt, evidence is the real name, no fabrication allowed', () => {
    const a = svc.getIdentity().answer;
    assert.match(a, /<source_owner>profile<\/source_owner>/, 'must be pinned to the profile source');
    assert.match(a, /<answer_type>identity_answer<\/answer_type>/);
    assert.match(a, /value=Evin John/, 'evidence must carry the real candidate name');
    assert.match(a, /Do not add facts.*unless present above/, 'must forbid fabrication beyond the listed evidence');
    assert.doesNotMatch(a, /Natively, an AI|I am Natively/i, 'must never instruct the app-identity voice');
  });

  test('intro → grounded in the candidate\'s own resume/projects/skills, never "I\'m Natively"', () => {
    const a = svc.getInterviewIntro();
    assert.match(a, /<source_owner>profile<\/source_owner>/);
    assert.match(a, /value=Evin John/);
    assert.match(a, /value=Software Engineer/, 'must surface the candidate\'s real experience as evidence');
    assert.doesNotMatch(a, /Natively, an AI|I am Natively/i);
  });

  test('skills/projects → profile-owned evidence for the correct answer type', () => {
    const skills = svc.getSkills();
    const projects = svc.getProjects();
    assert.match(skills, /<answer_type>skills_answer<\/answer_type>/);
    assert.match(skills, /value=\["Python","SQL","React"\]/);
    assert.match(projects, /value=Natively/);
    assert.doesNotMatch(skills, /value=Natively/, 'skills evidence must not smuggle in project facts');
  });

  // Profile-family sources only — never transcript/reference-files/meeting/browser
  // data leaking into a direct "tell me about yourself" style question.
  const PROFILE_FAMILY_SOURCES = new Set(['profile_resume', 'projects']);

  test('every direct profile question deterministically selects profile-only evidence', () => {
    for (const q of ['what is your name', 'introduce yourself', 'what are your skills', 'what are your projects', 'what is your experience']) {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'what_to_answer' });
      assert.ok(r, `"${q}" must resolve to a profile evidence selection`);
      // Evidence selection itself is deterministic and profile-scoped...
      assert.equal(r.usedDeterministicEvidenceSelection, true, `"${q}" evidence selection must be deterministic`);
      assert.equal(r.sourceOwner, 'profile', `"${q}" must be owned by the profile, not mixed/unknown`);
      assert.ok(r.checkedSources.length > 0, `"${q}" must check at least one source`);
      for (const src of r.checkedSources) {
        assert.ok(PROFILE_FAMILY_SOURCES.has(src), `"${q}" checked a non-profile source: ${src}`);
      }
      // ...but final prose is always JIT-generated (no canned string exists anymore —
      // r.answer is intentionally absent per the type contract).
      assert.equal(r.finalGenerationMode, 'jit_llm');
      assert.equal(r.providerUsed, true);
      assert.equal('answer' in r, false, `"${q}" result must not carry a deprecated literal answer field`);
    }
  });
});

describe('Experience-count evidence is FIRST-PERSON scoped to the candidate profile (A09)', () => {
  for (const q of [
    'How many years of experience do you have?',
    'how much experience do you have',
    'what is your experience',
    'what is your work experience',
  ]) {
    test(`"${q}" → profile-owned experience evidence, JIT-generated in first person`, () => {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'what_to_answer' });
      assert.ok(r, 'must resolve to an experience evidence selection');
      assert.equal(r.answerType, 'experience_answer');
      assert.equal(r.sourceOwner, 'profile', 'experience evidence must be profile-owned (candidate voice), never a generic/assistant answer');
      // Every selected experience item must be sourced from the candidate's own
      // resume, never a different source (the A09 first-person guarantee now lives
      // at the evidence layer: only profile_resume-sourced facts feed the JIT prompt,
      // so the LLM has no non-candidate material to speak from).
      assert.ok(r.items.length > 0, 'must select at least one experience evidence item');
      for (const item of r.items) {
        assert.equal(item.sourceKind, 'profile_resume', `experience item ${item.field} must be sourced from the candidate's own resume`);
      }
      assert.equal(r.selectedExperiences.length > 0, true, 'must surface the candidate\'s own experience entries');
    });
  }
});

describe('App identity vs Candidate identity', () => {
  const CANDIDATE = ['who are you', 'introduce yourself', 'what is your name', 'tell me who you are'];
  const APP = ['are you an AI', 'are you a bot', 'what is Natively', 'what model are you', 'who built you'];

  for (const q of CANDIDATE) {
    test(`candidate: "${q}" expects candidate voice (leak guard ON)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), false, `"${q}" is NOT an app-identity question`);
      const guard = ProfileTreeService.getCandidatePerspectiveGuard('looking-for-work', q);
      assert.equal(guard.expectCandidateVoice, true);
      assert.equal(guard.assistantIdentityWouldLeak, true);
    });
  }

  for (const q of APP) {
    test(`app: "${q}" is an app-identity question (answer as the app)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), true, `"${q}" IS an app-identity question`);
      const guard = ProfileTreeService.getCandidatePerspectiveGuard('looking-for-work', q);
      assert.equal(guard.isAppIdentityQuestion, true);
      assert.equal(guard.assistantIdentityWouldLeak, false);
      // The fast path bails (returns null) so the app/assistant identity path answers it.
      assert.equal(tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'manual_input' }), null);
    });
  }
});

describe('Privacy isolation — a ProfileTreeService can only see its own profile', () => {
  test("Bob's service never surfaces Alice's project", () => {
    const alice = new ProfileTreeService({ identity: { name: 'Alice' }, projects: [{ name: 'AliceSecretProj' }] }, null);
    const bob = new ProfileTreeService({ identity: { name: 'Bob' }, projects: [{ name: 'BobProj' }] }, null);
    assert.doesNotMatch(bob.getProjects() || '', /AliceSecretProj/);
    assert.match(bob.getIdentity().answer || '', /Bob/);
    assert.match(alice.getProjects() || '', /AliceSecretProj/);
  });
});
