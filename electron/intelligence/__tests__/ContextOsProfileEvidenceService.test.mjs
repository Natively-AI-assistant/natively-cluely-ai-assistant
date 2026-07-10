// Context OS Phase 13 — ProfileEvidenceService facade.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsProfileEvidenceService.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();
const service = new co.ProfileEvidenceService();

// A realistic structured resume for the legacy fast path.
const PROFILE = {
  fullName: 'Evin Johnson',
  headline: 'Senior Software Engineer',
  summary: 'Engineer with a decade of experience building desktop AI systems.',
  totalExperienceYears: 10,
  experience: [
    { title: 'Senior Engineer', company: 'Aetherbot AI', startDate: '2021-01', endDate: 'present', highlights: ['Led the assistant platform team'] },
  ],
  projects: [
    { name: 'Natively', description: 'Desktop AI meeting assistant with local RAG.', technologies: ['Electron', 'TypeScript'] },
  ],
  skills: ['TypeScript', 'Electron', 'Python'],
  education: [{ school: 'IIT', degree: 'B.Tech', endDate: '2016' }],
};

const JD = {
  title: 'Staff Engineer',
  company: 'TargetCo',
  requirements: ['5 years of Kubernetes', 'Strong Python'],
  responsibilities: ['Own the ML platform'],
};

function contractFor(sourceAuthority, question) {
  return kernel.build({
    surface: 'manual_chat', question, activeModeId: 'm1',
    sourceAuthority, answerShape: 'general',
    voicePerspective: 'first_person_candidate', enforcement: 'observe',
    hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: false,
  });
}

test('DOC-GROUNDED: facade refuses to consult the legacy fast path at all', () => {
  const contract = contractFor('reference_files_only', 'What is my best project?');
  assert.equal(service.canAnswerDeterministically({ contract }), false);
  assert.equal(service.selectEvidence({ question: 'What is my best project?', contract, profile: PROFILE, jobDescription: JD, answerType: 'project_answer' }), null);
  const pack = service.retrieveEvidence({ question: 'What is my best project?', contract, profile: PROFILE, jobDescription: JD, answerType: 'project_answer' });
  assert.equal(pack.items.length, 0);
  assert.equal(pack.answerPolicy, 'refuse_insufficient_evidence');
  assert.equal(pack.rejected[0].reason, 'forbidden_source');
  // No profile content anywhere.
  assert.ok(!JSON.stringify(pack).includes('Natively'));
  assert.ok(!JSON.stringify(pack).includes('Aetherbot'));
});

test('INTERVIEW: "what is my best project?" works through the facade', () => {
  const contract = contractFor('profile_plus_transcript', 'What is my best project?');
  assert.equal(service.canAnswerDeterministically({ contract }), true);
  const selection = service.selectEvidence({ question: 'What is my best project?', contract, profile: PROFILE, jobDescription: JD, answerType: 'project_answer' });
  assert.ok(selection, 'fast path should route a project question');
  const pack = service.retrieveEvidence({ question: 'What is my best project?', contract, profile: PROFILE, jobDescription: JD, answerType: 'project_answer' });
  assert.ok(pack.items.length > 0, 'expected profile evidence items');
  assert.ok(pack.items.every((i) => i.sourceOwner === 'profile'));
  assert.equal(pack.coverage.sourceOwnerSatisfied, true);
});

test('JD evidence is tagged role_requirement, never a candidate property', () => {
  const contract = contractFor('profile_plus_transcript', 'What does the job description require?');
  const pack = service.retrieveEvidence({ question: 'What does the job description require?', contract, profile: PROFILE, jobDescription: JD, answerType: 'jd_requirements_answer' });
  const jdItems = pack.items.filter((i) => i.sourceKind === 'profile_jd');
  assert.ok(jdItems.length > 0, `expected JD items, got kinds: ${pack.items.map((i) => i.sourceKind)}`);
  for (const it of jdItems) {
    assert.equal(it.supports.property, 'role_requirement');
  }
});

test('JD items cannot satisfy candidate_experience through the property validator', () => {
  const contract = contractFor('profile_plus_transcript', 'Do I have experience with Kubernetes?');
  assert.equal(contract.requestedProperty, 'candidate_experience');
  const pack = service.retrieveEvidence({ question: 'Do I have experience with Kubernetes?', contract, profile: PROFILE, jobDescription: JD, answerType: 'skill_experience_answer' });
  // Build a pack of ONLY the JD items and validate — must fail.
  const jdOnly = { ...pack, items: pack.items.filter((i) => i.sourceKind === 'profile_jd') };
  if (jdOnly.items.length > 0) {
    const v = co.validateEvidenceForProperty(jdOnly);
    assert.equal(v.ok, false, 'JD-only pack must not satisfy candidate_experience');
  }
});

test('facade never returns persona as evidence (style-only invariant)', () => {
  const contract = contractFor('profile_plus_transcript', 'What are my strongest skills?');
  const pack = service.retrieveEvidence({ question: 'What are my strongest skills?', contract, profile: PROFILE, jobDescription: JD, answerType: 'skills_answer' });
  assert.ok(pack.items.every((i) => i.sourceKind !== 'profile_persona'));
});

test('facade with broken profile input degrades to empty pack, never throws', () => {
  const contract = contractFor('profile_plus_transcript', 'What is my best project?');
  const pack = service.retrieveEvidence({ question: 'What is my best project?', contract, profile: null, jobDescription: null, answerType: 'project_answer' });
  assert.ok(Array.isArray(pack.items));
});
