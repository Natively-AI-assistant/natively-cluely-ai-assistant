// node:test — ProfileTreeService (deterministic Profile Tree facade).
// Validates spec Phase 2 + acceptance criteria: identity/projects/experience/skills/
// education/intro/role-fit are deterministic; NEVER "I am Natively"; NEVER "I don't
// know" when a profile exists; candidate first-person voice; Alice/Bob isolation.
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
  test('getIdentity is deterministic, first-person, names the candidate', () => {
    const tree = new ProfileTreeService(ALICE);
    const id = tree.getIdentity();
    assert.equal(id.name, 'Alice Chen');
    assert.equal(id.available, true);
    assert.match(id.answer, /Alice Chen/);
    assert.match(id.answer, /^my name is/i);
    assert.doesNotMatch(id.answer, NATIVELY_LEAK);
  });

  test('getInterviewIntro is grounded, first-person, never the assistant identity', () => {
    const tree = new ProfileTreeService(ALICE);
    const intro = tree.getInterviewIntro();
    assert.ok(intro, 'intro must be produced from structured facts');
    assert.match(intro, /Alice Chen/);
    assert.match(intro, /^i'?m alice/i);
    assert.doesNotMatch(intro, NATIVELY_LEAK);
    assert.doesNotMatch(intro, DONT_KNOW);
  });

  test('getProjects lists the candidate projects deterministically', () => {
    const tree = new ProfileTreeService(ALICE);
    const projects = tree.getProjects();
    assert.ok(projects);
    assert.match(projects, /RecoEngine/);
    assert.match(projects, /FraudGuard/);
    assert.match(projects, /^my projects include/i);
  });

  test('getExperience and getSkills and getEducation answer in first person', () => {
    const tree = new ProfileTreeService(ALICE);
    const exp = tree.getExperience();
    assert.match(exp, /Senior ML Engineer/);
    assert.match(exp, /^my experience includes/i);
    const skills = tree.getSkills();
    assert.match(skills, /Python/);
    assert.match(skills, /^my skills include/i);
    const edu = tree.getEducation();
    assert.match(edu, /Stanford/);
    assert.match(edu, /^my education includes/i);
  });

  test('getRoleFit combines profile + JD (skill/experience matching)', () => {
    const tree = new ProfileTreeService(ALICE, JD);
    const fit = tree.getRoleFit();
    assert.ok(fit, 'role fit must be produced when JD is present');
    assert.match(fit, /Machine Learning Engineer/);
    assert.match(fit, /BigCo/);
    assert.match(fit, /^i fit/i);
  });

  test('getRoleFit returns null when no JD is loaded (defers to LLM, never fabricates)', () => {
    const tree = new ProfileTreeService(ALICE, null);
    assert.equal(tree.getRoleFit(), null);
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
