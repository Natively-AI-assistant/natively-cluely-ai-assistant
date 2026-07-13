// node:test — ProfileTreeService (deterministic Profile Tree facade).
// Validates spec Phase 2 + acceptance criteria: identity/projects/experience/skills/
// education/intro/role-fit are deterministic; NEVER "I am Natively"; NEVER "I don't
// know" when a profile exists; candidate first-person voice; Alice/Bob isolation.
//
// UPDATED 2026-07-11 (Context OS ownership audit): ProfileTreeService.get*() no
// longer returns literal first-person prose. Per the service's own "answer()"
// docstring: "This service no longer returns deterministic final prose; callers
// must pass this prompt to a provider when a user-visible answer is needed." Every
// getter now returns a structured JIT prompt (<profile_jit_final_answer_request>)
// with <source_owner>profile</source_owner>, an <allowed_evidence> list of the
// candidate's own facts, and hard anti-fabrication <rules>. This is a STRONGER
// ownership guarantee than the old literal-string match (the model literally
// cannot see another profile's data or a "the assistant" framing), so these tests
// now assert the structural contract instead of exact prose. Also: getRoleFit()
// does NOT return null when the JD is merely absent — see its corrected docstring
// in ProfileTreeService.ts (still returns null only with zero usable evidence).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileTreeService } from '../../../dist-electron/electron/intelligence/ProfileTreeService.js';

const ALICE = {
  identity: { name: 'Alice Chen' },
  experience: [
    { role: 'Senior ML Engineer', company: 'Acme AI', bullets: ['Built a recommender serving 10M users'] },
    { role: 'Data Scientist', company: 'DataCorp' },
  ],
  projects: [
    { name: 'RecoEngine', description: 'a real-time recommender', technologies: ['Python', 'PyTorch', 'Redis'] },
    { name: 'FraudGuard', description: 'fraud detection pipeline', technologies: ['Spark', 'SQL'] },
  ],
  skills: ['Python', 'PyTorch', 'SQL', 'Spark', 'Redis'],
  education: [{ degree: 'MS', field: 'Computer Science', institution: 'Stanford' }],
};

const BOB = {
  identity: { name: 'Bob Martinez' },
  experience: [{ role: 'Frontend Engineer', company: 'WebShop' }],
  projects: [{ name: 'CheckoutFlow', description: 'a payments UI', technologies: ['React', 'TypeScript'] }],
  skills: ['React', 'TypeScript', 'CSS'],
  education: [{ degree: 'BS', field: 'Design', institution: 'RISD' }],
};

const JD = {
  title: 'Machine Learning Engineer',
  company: 'BigCo',
  requirements: ['Python', 'PyTorch', 'distributed systems'],
};

const NATIVELY_LEAK = /\bi'?m natively\b|\bi am natively\b|\ban ai assistant\b/i;
const DONT_KNOW = /\bi don'?t (know|have access)\b|\bi'?m not sure\b|\bi cannot help\b/i;

describe('ProfileTreeService', () => {
  test('getIdentity is deterministic, profile-owned JIT prompt, names the candidate', () => {
    const tree = new ProfileTreeService(ALICE);
    const id = tree.getIdentity();
    assert.equal(id.name, 'Alice Chen');
    assert.equal(id.available, true);
    assert.match(id.answer, /<source_owner>profile<\/source_owner>/);
    assert.match(id.answer, /value=Alice Chen/);
    assert.doesNotMatch(id.answer, NATIVELY_LEAK);
  });

  test('getInterviewIntro is grounded in the candidate\'s own facts, never the assistant identity', () => {
    const tree = new ProfileTreeService(ALICE);
    const intro = tree.getInterviewIntro();
    assert.ok(intro, 'intro must be produced from structured facts');
    assert.match(intro, /<source_owner>profile<\/source_owner>/);
    assert.match(intro, /value=Alice Chen/);
    assert.match(intro, /value=Senior ML Engineer/, 'intro evidence must include real experience facts');
    assert.doesNotMatch(intro, NATIVELY_LEAK);
    assert.doesNotMatch(intro, DONT_KNOW);
  });

  test('getProjects lists the candidate projects deterministically as evidence', () => {
    const tree = new ProfileTreeService(ALICE);
    const projects = tree.getProjects();
    assert.ok(projects);
    assert.match(projects, /<answer_type>project_answer<\/answer_type>/);
    assert.match(projects, /value=RecoEngine/);
    assert.match(projects, /value=FraudGuard/);
  });

  test('getExperience and getSkills and getEducation surface first-person-scoped evidence', () => {
    const tree = new ProfileTreeService(ALICE);
    const exp = tree.getExperience();
    assert.match(exp, /<answer_type>experience_answer<\/answer_type>/);
    assert.match(exp, /value=Senior ML Engineer/);
    const skills = tree.getSkills();
    assert.match(skills, /<answer_type>skills_answer<\/answer_type>/);
    assert.match(skills, /Python/);
    const edu = tree.getEducation();
    assert.match(edu, /Stanford/);
  });

  test('getRoleFit combines profile + JD (skill/experience matching)', () => {
    const tree = new ProfileTreeService(ALICE, JD);
    const fit = tree.getRoleFit();
    assert.ok(fit, 'role fit must be produced when JD is present');
    assert.match(fit, /value=Machine Learning Engineer/);
    assert.match(fit, /value=BigCo/);
    assert.match(fit, /<answer_type>jd_fit_answer<\/answer_type>/);
    // Source-separation rules must keep JD facts and candidate facts distinct —
    // this is the anti-contamination guarantee for JD-fit answers.
    assert.match(fit, /target_job_evidence describes the TARGET ROLE/);
    assert.match(fit, /candidate_resume_evidence describes the CANDIDATE/);
  });

  test('getRoleFit degrades gracefully (never fabricates JD facts) when no JD is loaded', () => {
    const tree = new ProfileTreeService(ALICE, null);
    const fit = tree.getRoleFit();
    // Corrected 2026-07-11: this no longer returns null — selectManualProfileEvidence's
    // JD_FIT_PATTERNS fallback branch still answers from the candidate's REAL
    // skills/experience/projects when a fit question is asked with no JD loaded.
    // The guarantee that matters is: it must never invent JD facts.
    assert.ok(fit, 'must still produce a profile-grounded answer, not silently refuse');
    assert.doesNotMatch(fit, /<target_job_evidence/, 'must not fabricate a target-job-evidence section with no JD loaded');
    assert.match(fit, /value=Alice Chen|value=Senior ML Engineer|value=RecoEngine/, 'must ground in real candidate facts');
    assert.match(fit, /No exact JD skill matches were found|profile skills, experience, projects/i);
  });

  test('getCompactIdentityBlock is a tight grounded block', () => {
    const tree = new ProfileTreeService(ALICE);
    const block = tree.getCompactIdentityBlock();
    assert.ok(block);
    assert.match(block, /Alice/);
    assert.doesNotMatch(block, NATIVELY_LEAK);
  });

  test('NEVER "I don\'t know" when a profile exists — across all getters', () => {
    const tree = new ProfileTreeService(ALICE, JD);
    for (const v of [tree.getIdentity().answer, tree.getInterviewIntro(), tree.getProjects(), tree.getExperience(), tree.getSkills(), tree.getEducation(), tree.getRoleFit()]) {
      assert.ok(v, 'every facet present in the fixture must produce an answer');
      assert.doesNotMatch(v, DONT_KNOW);
      assert.doesNotMatch(v, NATIVELY_LEAK);
    }
  });

  test('PRIVACY/ISOLATION: Bob\'s tree can never surface Alice\'s project', () => {
    const bobTree = new ProfileTreeService(BOB);
    const everything = [
      bobTree.getIdentity().answer, bobTree.getInterviewIntro(), bobTree.getProjects(),
      bobTree.getExperience(), bobTree.getSkills(), bobTree.getEducation(),
      bobTree.getCompactIdentityBlock(), bobTree.getBackground(),
    ].filter(Boolean).join(' ');
    assert.doesNotMatch(everything, /Alice/);
    assert.doesNotMatch(everything, /RecoEngine/);
    assert.doesNotMatch(everything, /FraudGuard/);
    assert.doesNotMatch(everything, /Stanford/);
    // And it DOES surface Bob's own facts.
    assert.match(everything, /Bob Martinez/);
    assert.match(everything, /CheckoutFlow/);
  });

  test('getBestProject returns the flagship project deterministically', () => {
    const tree = new ProfileTreeService(ALICE);
    const best = tree.getBestProject();
    assert.ok(best, 'best project should resolve from structured data');
    assert.match(best, /RecoEngine/);
  });

  test('getCandidatePerspectiveGuard blocks "I am Natively" in candidate-voice modes', () => {
    for (const mode of ['technical-interview', 'looking-for-work', '', 'general']) {
      const v = ProfileTreeService.getCandidatePerspectiveGuard(mode, 'introduce yourself');
      assert.equal(v.expectCandidateVoice, true, `mode=${mode} should expect candidate voice`);
      assert.equal(v.assistantIdentityWouldLeak, true);
      assert.equal(v.isAppIdentityQuestion, false);
    }
  });

  test('getCandidatePerspectiveGuard exempts genuine app-identity questions', () => {
    for (const q of ['are you an AI?', 'what is Natively?', 'what model are you?']) {
      const v = ProfileTreeService.getCandidatePerspectiveGuard('technical-interview', q);
      assert.equal(v.isAppIdentityQuestion, true, `"${q}" is an app question`);
      assert.equal(v.assistantIdentityWouldLeak, false, `"${q}" may answer as the assistant`);
    }
  });

  test('getCandidatePerspectiveGuard does not force candidate voice in non-candidate modes', () => {
    const v = ProfileTreeService.getCandidatePerspectiveGuard('sales', 'introduce yourself');
    assert.equal(v.expectCandidateVoice, false);
    assert.equal(v.assistantIdentityWouldLeak, false);
  });

  test('empty/absent profile → not ready, getters return null (no fabrication)', () => {
    const tree = new ProfileTreeService(null);
    assert.equal(tree.isReady(), false);
    assert.equal(tree.getIdentity().available, false);
    assert.equal(tree.getProjects(), null);
    assert.equal(tree.getInterviewIntro(), null);
    assert.equal(tree.getCompactIdentityBlock(), null);
  });

  test('fromSource reads the orchestrator-shaped activeResume/activeJD', () => {
    const tree = ProfileTreeService.fromSource({
      activeResume: { structured_data: ALICE },
      activeJD: { structured_data: JD },
    });
    assert.equal(tree.getIdentity().name, 'Alice Chen');
    assert.match(tree.getRoleFit(), /BigCo/);
  });
});
