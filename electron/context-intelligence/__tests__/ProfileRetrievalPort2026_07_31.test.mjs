// Context Intelligence V3 — profile retrieval port (2026-07-31 source-routing fix).
//
// The live defect: Looking-for-Work planned [RESUME, PROFILE_FACT] but the only
// private-source pool was the mode-attachment port, so a profile processed once
// through Profile Intelligence resolved to ZERO evidence and the assistant told
// the user to upload documents they had already uploaded. This file pins the
// port that closes that gap: registration, authorization, versioning, scope,
// section rendering (including the fields the OKF card templates DROP), ranking,
// complete-inventory metadata, and cross-port dedup.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort, renderProfileSections } =
  await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { combineRetrievalPorts } =
  await import(pathToFileURL(path.join(base, 'retrieval/meeting-retrieval-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { resolveModePolicy } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

// ── fixture: the acceptance-spec documents ──────────────────────────────────
const RESUME_STRUCTURED = {
  identity: { name: 'Evin John', summary: 'Engineer shipping user-facing AI products. Built Natively, an open-source AI desktop assistant used by 16,000+ users.', location: 'Kochi, Kerala' },
  skills: {
    Languages: ['TypeScript', 'JavaScript', 'Python', 'Java', 'SQL', 'C++'],
    Frameworks: ['React', 'Node.js', 'FastAPI', 'Electron'],
  },
  skills_flat: ['TypeScript', 'JavaScript', 'Python', 'Java', 'SQL', 'C++', 'React', 'Node.js', 'FastAPI', 'Electron'],
  experience: [
    { company: 'Aetherbot AI', role: 'Software Engineer Intern', start_date: 'Dec 2024', end_date: 'Mar 2025',
      bullets: ['Engineered a real-time pixel-streaming pipeline on AWS EC2 with sub-80ms interaction latency', 'Improved React/Node.js workflows contributing to a reported 25% increase in customer retention'] },
    { company: 'EstroTech Robotics', role: 'AI & Full Stack Engineer Intern', start_date: 'Jun 2025', end_date: 'Aug 2025',
      bullets: ['Built a Python/FastAPI backend processing voice and touch inputs with sub-100ms latency'] },
  ],
  projects: [
    { name: 'Natively', description: 'Built and launched an open-source AI meeting copilot. Grew to 16,000+ users, 1,500+ GitHub stars and $25K+ revenue.', technologies: ['Electron', 'TypeScript', 'Rust', 'SQLite'] },
    { name: 'TalentScope', description: 'Real-time technical interview platform with RBAC and collaborative coding.', technologies: ['React', 'Node.js'] },
  ],
  education: [{ institution: 'CUSAT', degree: 'B.Tech', field: 'Computer Science Engineering', gpa: '7.5/10' }],
  achievements: [],
};

const JD_STRUCTURED = {
  title: 'Software Engineer II', company: 'Google', location: 'Bengaluru', level: 'SWE II',
  description_summary: 'Build and scale products used by billions.',
  requirements: [
    '2+ years of professional software development experience',
    'Proficiency in one or more of Java, C++, Go, Python, or Kotlin',
    'Experience with microservices, Kubernetes, Docker and REST APIs',
  ],
  nice_to_haves: ['Kubernetes in production', 'Distributed systems experience'],
  responsibilities: ['Design, develop, test, deploy and maintain software'],
  keywords: ['Java', 'C++', 'Go', 'Python', 'Kotlin', 'Kubernetes'],
  technologies: ['Kubernetes', 'Docker'],
  compensation_hint: 'Base Salary: ₹35–55 LPA; Annual Performance Bonus; Google RSUs',
  min_years_experience: 2,
  employment_type: 'full_time',
};

const RESUME_DOC = {
  kind: 'resume', sourceId: 'psrc_resume_test', versionId: 'rv1',
  fileName: 'Candidate Resume (Profile Intelligence)', structured: RESUME_STRUCTURED,
};
const JD_DOC = {
  kind: 'jd', sourceId: 'psrc_jd_test', versionId: 'jv1',
  fileName: 'Target Job Description (Profile Intelligence)', structured: JD_STRUCTURED,
};

const LFW = resolveModePolicy('looking-for-work');
const lfwPort = (docs = [RESUME_DOC, JD_DOC], over = {}) => createProfileRetrievalPort({
  docs, allowedSourceTypes: LFW.allowedSourceTypes, profileSources: LFW.profileSources,
  userId: 'local', ...over,
});

const lfwDecision = (q) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId: 'looking-for-work', scope: { userId: 'local' }, sessionId: 'pt-s1',
  manualQuestion: q,
});

describe('registration and authorization', () => {
  test('résumé resolves to RESUME and JD to JOB_DESCRIPTION with full provenance', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.ok(r.evidence.length > 0, 'profile evidence must exist with ZERO mode attachments');
    const resume = r.evidence.find((e) => e.sourceId === 'psrc_resume_test');
    assert.ok(resume, 'résumé evidence present');
    assert.equal(resume.sourceType, 'RESUME');
    assert.equal(resume.versionId, 'rv1');
    assert.equal(resume.retrievedVersionId, 'rv1');
    assert.equal(resume.scopeId, 'u:local');
  });

  test('a mode with an EMPTY profileSources opt-in gets NO port at all (recruiting)', () => {
    const rec = resolveModePolicy('recruiting');
    assert.deepEqual(rec.profileSources, [], 'recruiting must never hydrate the user profile');
    const p = createProfileRetrievalPort({
      docs: [RESUME_DOC, JD_DOC], allowedSourceTypes: rec.allowedSourceTypes,
      profileSources: rec.profileSources, userId: 'local',
    });
    assert.equal(p, null);
  });

  test('profileSources is a subset of allowedSourceTypes in EVERY mode', async () => {
    const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
    for (const policy of Object.values(MODE_POLICIES)) {
      for (const t of policy.profileSources) {
        assert.ok(policy.allowedSourceTypes.includes(t),
          `${policy.id}: profileSources entry ${t} missing from allowedSourceTypes`);
      }
    }
  });

  test('only looking-for-work and technical-interview opt in; all others stay attachment-only', async () => {
    const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
    assert.deepEqual([...MODE_POLICIES['looking-for-work'].profileSources].sort(),
      ['JOB_DESCRIPTION', 'PROFILE_FACT', 'RESUME']);
    assert.deepEqual([...MODE_POLICIES['technical-interview'].profileSources].sort(),
      ['JOB_DESCRIPTION', 'RESUME']);
    for (const id of ['general', 'sales', 'recruiting', 'team-meet', 'lecture', 'seminar']) {
      assert.deepEqual(MODE_POLICIES[id].profileSources, [], `${id} must not hydrate the profile`);
    }
  });

  test('a doc without identity fails closed rather than guessing', () => {
    const p = createProfileRetrievalPort({
      docs: [{ ...RESUME_DOC, sourceId: '' }], allowedSourceTypes: LFW.allowedSourceTypes,
      profileSources: LFW.profileSources, userId: 'local',
    });
    assert.equal(p, null, 'no registrable doc ⇒ no port');
  });

  test('no active résumé: the JD alone still serves; no active JD: the résumé alone still serves', async () => {
    const jdOnly = await lfwPort([JD_DOC]).retrieve({ decision: lfwDecision('What is the base salary?') });
    assert.ok(jdOnly.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION'));
    assert.ok(!jdOnly.evidence.some((e) => e.sourceType === 'RESUME'));
    const resumeOnly = await lfwPort([RESUME_DOC]).retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.ok(resumeOnly.evidence.some((e) => e.sourceType === 'RESUME'));
    assert.ok(!resumeOnly.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION'));
  });
});

describe('the fields the card pipeline drops', () => {
  test('compensation_hint and min_years_experience render into JD sections', () => {
    const sections = renderProfileSections('jd', JD_STRUCTURED);
    const comp = sections.find((s) => s.section === 'Compensation & experience bar');
    assert.ok(comp, 'the salary band must be retrievable — no card carries it');
    assert.ok(comp.text.includes('₹35–55 LPA'));
    assert.ok(comp.text.includes('2+ years'));
    // Retrievable by term match, but NOT an inventory — a comp blurb must not
    // license term-free absence claims (review hardening).
    assert.equal(comp.completeInventory, false);
  });

  test('the salary question retrieves the compensation section', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('What is the base salary?') });
    assert.ok(r.evidence.some((e) => e.content.includes('₹35–55 LPA')),
      'the base salary band must reach evidence');
  });

  test('CGPA is retrievable from the education section', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.ok(r.evidence.some((e) => e.content.includes('7.5/10')));
  });

  test('Aetherbot facts are retrievable from the per-entry experience section', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('What did I do at Aetherbot?') });
    const hit = r.evidence.find((e) => e.content.includes('pixel-streaming'));
    assert.ok(hit, 'the Aetherbot entry must surface');
    assert.ok(hit.content.includes('sub-80ms'));
    assert.ok(hit.content.includes('25%'));
  });
});

describe('complete-inventory metadata (grounded absence)', () => {
  test('the skills inventory is marked completeInventory and surfaces for a presence check', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('Do I have Kubernetes experience?') });
    const skills = r.evidence.find((e) => e.metadata?.completeInventory === true && e.sourceType === 'RESUME');
    assert.ok(skills, 'a complete résumé inventory must be in evidence for a skill-presence question');
    assert.ok(!skills.content.includes('Kubernetes'),
      'fixture sanity: the résumé really does not list Kubernetes');
  });

  test('per-entry narrative sections are NOT marked complete', () => {
    const sections = renderProfileSections('resume', RESUME_STRUCTURED);
    const aether = sections.find((s) => s.section.includes('Aetherbot'));
    assert.equal(aether.completeInventory, false,
      'one entry is a fragment — absence from it proves nothing');
  });

  test('JD requirements list is complete — grounded "the JD does not ask for X"', () => {
    const sections = renderProfileSections('jd', JD_STRUCTURED);
    const reqs = sections.find((s) => s.section === 'Job requirements (complete)');
    assert.equal(reqs.completeInventory, true);
    assert.equal(reqs.inventoryCategory, 'requirements');
    assert.ok(reqs.text.includes('Kotlin'));
  });
});

describe('versioning and updates', () => {
  test('a replaced résumé serves the NEW facts under the NEW version id', async () => {
    const updated = {
      ...RESUME_DOC, versionId: 'rv2',
      structured: { ...RESUME_STRUCTURED, education: [{ institution: 'CUSAT', degree: 'B.Tech', field: 'CSE', gpa: '8.2/10' }] },
    };
    const r = await lfwPort([updated, JD_DOC]).retrieve({ decision: lfwDecision('What is my CGPA?') });
    const edu = r.evidence.find((e) => e.content.includes('8.2/10'));
    assert.ok(edu, 'the new fact must be served');
    assert.equal(edu.versionId, 'rv2');
    assert.ok(!r.evidence.some((e) => e.content.includes('7.5/10')), 'the old fact is gone');
  });

  test('excludeVersionIds drops the canonical duplicate of a mode attachment', async () => {
    const p = createProfileRetrievalPort({
      docs: [RESUME_DOC, JD_DOC], allowedSourceTypes: LFW.allowedSourceTypes,
      profileSources: LFW.profileSources, userId: 'local', excludeVersionIds: ['rv1'],
    });
    const r = await p.retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.ok(!r.evidence.some((e) => e.sourceId === 'psrc_resume_test'),
      'the excluded résumé must not be served twice');
  });
});

describe('scope and card hygiene', () => {
  test('a userId mismatch rejects every chunk OUT_OF_SCOPE', async () => {
    const p = createProfileRetrievalPort({
      docs: [RESUME_DOC], allowedSourceTypes: LFW.allowedSourceTypes,
      profileSources: LFW.profileSources, userId: 'someone-else',
    });
    const r = await p.retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.equal(r.evidence.length, 0);
    assert.ok(r.attempts[0].rejections.every((x) => x.reason === 'OUT_OF_SCOPE'));
  });

  test('rejected cards are never served', async () => {
    const doc = {
      ...RESUME_DOC,
      cards: [
        { id: 'c1', type: 'candidate_summary', title: 'Rejected card', body: 'UNIQUEREJECTEDTOKEN body', approvalStatus: 'rejected' },
        { id: 'c2', type: 'candidate_summary', title: 'Good card', body: 'UNIQUEACCEPTEDTOKEN body', approvalStatus: 'generated' },
      ],
    };
    const r = await lfwPort([doc]).retrieve({ decision: lfwDecision('Tell me about UNIQUEREJECTEDTOKEN and UNIQUEACCEPTEDTOKEN') });
    assert.ok(!r.evidence.some((e) => e.content.includes('UNIQUEREJECTEDTOKEN')));
    assert.ok(r.evidence.some((e) => e.content.includes('UNIQUEACCEPTEDTOKEN')));
  });
});

describe('cross-port dedup in combineRetrievalPorts', () => {
  const mk = (sourceId, score, metadata = {}) => ({
    async retrieve() {
      return {
        evidence: [{
          evidenceId: `ev-${sourceId}-0`, sourceType: 'RESUME', sourceId,
          versionId: 'v', retrievedVersionId: 'v', scopeId: 'u:local',
          content: 'CGPA: 7.5/10 at CUSAT', finalScore: score,
          authorityFor: ['USER_EDUCATION'], acceptedFor: ['USER_EDUCATION'],
          isDirectFact: true, isInferred: false, metadata, trustLevel: 'untrusted_reference',
        }],
        attempts: [],
      };
    },
  });

  test('identical passages from two sources keep only the higher-scoring copy', async () => {
    const combined = combineRetrievalPorts([mk('profile-resume', 0.9), mk('mode-file-copy', 0.5)]);
    const r = await combined.retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.equal(r.evidence.length, 1, 'the duplicate passage is served once');
    assert.equal(r.evidence[0].sourceId, 'profile-resume', 'the higher-scoring copy wins');
  });

  test('the complete-record declaration survives even when the unstamped copy wins', async () => {
    const combined = combineRetrievalPorts([
      mk('mode-file-copy', 0.9),                                       // wins on score, no metadata
      mk('profile-resume', 0.5, { completeInventory: true, inventoryCategory: 'education' }),
    ]);
    const r = await combined.retrieve({ decision: lfwDecision('What is my CGPA?') });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].metadata.completeInventory, true,
      'identical text: the declaration transfers, or the absence contract silently stops rendering');
  });
});

describe('review hardening: boost-only ranking', () => {
  test('a fired-intent inventory is policy-admitted at 0.6 — below real matches, above the cut', async () => {
    const r = await lfwPort().retrieve({ decision: lfwDecision('Do I know COBOL?') });
    // 'COBOL' appears nowhere; the skills inventory can never rank on
    // similarity for the very questions it exists to answer, so it is admitted
    // at a fixed 0.6 — beneath genuine lexical matches (0.7+) so it cannot
    // displace real mode-attachment hits at the top of the cap.
    const skills = r.evidence.find((e) => e.metadata?.completeInventory === true
      && e.metadata?.inventoryCategory === 'skills');
    assert.ok(skills, 'the inventory must be present for grounded absence');
    assert.ok(Math.abs(skills.finalScore - 0.6) < 1e-9, `policy-admitted score, got ${skills.finalScore}`);
  });
});
