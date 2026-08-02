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

// ---------------------------------------------------------------------------
// 2026-08-02: identity/contact lookups were structurally unretrievable.
//
// THE LIVE DEFECT (production log, packaged 2.8.5): "what is my name" in
// Looking-for-Work and Technical Interview, with a résumé successfully ingested
// through Profile Intelligence, logged
//   planned:["RESUME","PROFILE_FACT"] evidence:0 retrieval:[{candidates:0}]
//   answerability:"NONE" fallback:"DOCUMENT_FACT_NOT_FOUND"
// and the assistant told the user it had no résumé. Attaching the SAME file as
// a mode reference file answered it (that port is embedding-backed), which is
// exactly the "I have to manually attach them" workaround the user reported.
//
// ROOT CAUSE: this port ranks by BM25 over `section + text`, and the identity
// section held only VALUES ("Evin John. Kochi, Kerala") — the token "name"
// appeared nowhere in the corpus, so every chunk scored 0 and the
// `score > 0.05` cut dropped them all. Reproduced against the real shipped DB
// before the fix; both halves of the fix are pinned below.
// ---------------------------------------------------------------------------
describe('identity & contact lookups (2026-08-02)', () => {
  const CONTACT_RESUME = {
    ...RESUME_STRUCTURED,
    identity: {
      name: 'Evin John', summary: 'Engineer shipping user-facing AI products.',
      location: 'Kochi, Kerala', email: 'evin@example.com', phone: '+91 90000 11111',
      linkedin: 'linkedin.com/in/evinjohn', github: 'github.com/evinjohn',
    },
  };
  const contactPort = () => lfwPort([{ ...RESUME_DOC, structured: CONTACT_RESUME }]);

  test('"what is my name" retrieves the identity section (was ZERO evidence)', async () => {
    // Pin the LIVE path, not just the port. The production log's turn planned
    // ["RESUME","PROFILE_FACT"]; if the real planner ever stopped emitting
    // RESUME here, the identity chunk would be dropped by PLANNED_TYPE_FILTER
    // downstream and this test would still pass on a turn the user never runs.
    const decision = lfwDecision('what is my name');
    assert.deepEqual([...decision.retrievalPlan.sourceTypes], ['RESUME', 'PROFILE_FACT'],
      'the plan this fix depends on must match the one the production log recorded');

    const r = await contactPort().retrieve({ decision });
    const id = r.evidence.find((e) => e.section === 'Identity & summary');
    assert.ok(id, 'the identity section must be retrievable by the question that asks for it');
    assert.equal(id.sourceType, 'RESUME', 'must survive the planned-type filter, not merely be retrieved');
    assert.match(id.content, /Name: Evin John/);
  });

  test('Technical Interview (plans RESUME only) resolves it too — the second mode reported', async () => {
    const ti = resolveModePolicy('technical-interview');
    const port = createProfileRetrievalPort({
      docs: [{ ...RESUME_DOC, structured: CONTACT_RESUME }],
      allowedSourceTypes: ti.allowedSourceTypes, profileSources: ti.profileSources, userId: 'local',
    });
    assert.ok(port, 'technical-interview must hydrate the profile at all');
    const decision = decide({
      requestId: 'r-ti', requestSequence: 1, surface: 'manual-chat',
      modeId: 'technical-interview', scope: { userId: 'local' }, sessionId: 'pt-ti',
      manualQuestion: 'whats my name',
    });
    assert.deepEqual([...decision.retrievalPlan.sourceTypes], ['RESUME'],
      'matches the production log for technical-interview');
    const r = await port.retrieve({ decision });
    const id = r.evidence.find((e) => e.section === 'Identity & summary');
    assert.ok(id, 'Technical Interview logged evidence:0 for this exact question');
    assert.equal(id.sourceType, 'RESUME');
  });

  test('the identity boost does not displace substantive evidence from the cap', async () => {
    // The port's own comment warns that flat additive boosts crowded real hits
    // out of the 6-item cap. A boosted-but-lexically-unmatched identity chunk
    // is admitted at <=0.35, beneath genuine matches (0.7+), so a question with
    // real subject matter must still rank that subject matter first.
    const port = lfwPort([{ ...RESUME_DOC, structured: CONTACT_RESUME }, JD_DOC]);
    const r = await port.retrieve({ decision: lfwDecision('tell me about my background in Python') });
    const idIdx = r.evidence.findIndex((e) => e.section === 'Identity & summary');
    assert.ok(idIdx !== 0,
      'identity must not outrank the substantive chunks for a question that has a real subject');
  });

  test('contact fields are rendered at all — they were extracted and dropped', () => {
    const sections = renderProfileSections('resume', CONTACT_RESUME);
    const id = sections.find((s) => s.section === 'Identity & summary');
    assert.ok(id, 'identity section must exist');
    for (const [label, value] of [
      ['Email', 'evin@example.com'], ['Phone', '+91 90000 11111'],
      ['LinkedIn', 'linkedin.com/in/evinjohn'], ['GitHub', 'github.com/evinjohn'],
    ]) {
      assert.match(id.text, new RegExp(`${label}: ${value.replace(/[+.*?^${}()|[\]\\]/g, '\\$&')}`),
        `${label} is extracted by StructuredExtractor and must reach the model`);
    }
  });

  test('"what is my email" retrieves it (previously unanswerable even when present)', async () => {
    const r = await contactPort().retrieve({ decision: lfwDecision('what is my email') });
    const id = r.evidence.find((e) => e.section === 'Identity & summary');
    assert.ok(id, 'email lookups must reach the identity section');
    assert.match(id.content, /evin@example\.com/);
  });

  test('field-free phrasings still land via the intent boost, not luck', async () => {
    for (const q of ['who am i', 'summarize my background', 'what are my contact details']) {
      const r = await contactPort().retrieve({ decision: lfwDecision(q) });
      assert.ok(r.evidence.some((e) => e.section === 'Identity & summary'),
        `"${q}" must retrieve identity`);
    }
  });

  test('the identity section is STILL not an inventory — it must not ground absences', () => {
    const id = renderProfileSections('resume', CONTACT_RESUME)
      .find((s) => s.section === 'Identity & summary');
    assert.equal(id.completeInventory, false,
      'labelling the fields must not turn a contact blurb into an absence-licensing inventory');
  });

  test('an empty contact field renders nothing rather than an empty label', () => {
    const sparse = { ...RESUME_STRUCTURED, identity: { name: 'Rohan Varma', email: '', phone: '', location: 'Kochi, India' } };
    const id = renderProfileSections('resume', sparse).find((s) => s.section === 'Identity & summary');
    assert.match(id.text, /Name: Rohan Varma/);
    assert.doesNotMatch(id.text, /Email:/, 'an empty extraction slot must not render a dangling label');
    assert.doesNotMatch(id.text, /Phone:/);
  });
});

// ---------------------------------------------------------------------------
// 2026-08-02: PROFILE_FACT was a planned source type with a structurally empty
// pool. "What is my expected salary" planned [RESUME, PROFILE_FACT]; the résumé
// is silent on the subject by nature, PROFILE_FACT resolved to nothing, and the
// turn answered DOCUMENT_FACT_NOT_FOUND — about a figure SalaryIntelligence had
// already computed and written to the log ("Resume-based estimate: INR
// 350,000-650,000 (medium)"). Derived facts now hydrate that pool.
// ---------------------------------------------------------------------------
describe('derived profile facts (PROFILE_FACT, 2026-08-02)', () => {
  const SALARY = { salary_estimate: {
    role: 'Software Engineer', location: 'Kochi, India', currency: 'INR',
    min: 350000, max: 650000, confidence: 'medium',
    justification_factors: ['0.6 years professional experience'],
    estimated_at: '2026-08-02T03:47:24Z' } };
  const FACT_DOC = {
    kind: 'fact', sourceId: 'psrc_fact_test', versionId: 'fv1',
    fileName: 'Derived profile facts (Profile Intelligence)', structured: SALARY,
  };
  const factPort = () => lfwPort([FACT_DOC]);

  test('"what is my expected salary" resolves (was DOCUMENT_FACT_NOT_FOUND)', async () => {
    const decision = lfwDecision('what is my expected salary');
    assert.ok(decision.retrievalPlan.sourceTypes.includes('PROFILE_FACT'),
      'the planner asks for PROFILE_FACT — that is why the empty pool was a defect');
    const r = await factPort().retrieve({ decision });
    const fact = r.evidence.find((e) => e.sourceType === 'PROFILE_FACT');
    assert.ok(fact, 'the computed estimate must be reachable');
    assert.match(fact.content, /350,000/);
    assert.equal(fact.provenance, 'PROFILE_FACT');
  });

  test('the estimate carries its own "derived, not on the résumé" qualification', async () => {
    const r = await factPort().retrieve({ decision: lfwDecision('what is my expected salary') });
    const fact = r.evidence.find((e) => e.sourceType === 'PROFILE_FACT');
    // The retrieved CHUNK is what the model sees, so the qualification has to
    // travel with the number rather than live in a prompt rule that may not be
    // restated. Without it the model reports an estimate as a résumé line item.
    assert.match(fact.content, /DERIVED ESTIMATE/);
    assert.match(fact.content, /NOT stated\s+anywhere on the résumé|NOT stated anywhere on the résumé/);
    assert.match(fact.content, /NOT an offer/);
  });

  test('a derived fact never licenses an absence claim', () => {
    const sections = renderProfileSections('fact', SALARY);
    assert.ok(sections.length > 0);
    for (const s of sections) {
      assert.equal(s.completeInventory, false,
        'one computed figure enumerates nothing and must not ground a negative');
    }
  });

  test('a mode that does not opt into PROFILE_FACT gets no fact source', () => {
    const ti = resolveModePolicy('technical-interview');
    assert.ok(!ti.profileSources.includes('PROFILE_FACT'),
      'Technical Interview deliberately does not hydrate derived facts');
    const port = createProfileRetrievalPort({
      docs: [FACT_DOC], allowedSourceTypes: ti.allowedSourceTypes,
      profileSources: ti.profileSources, userId: 'local',
    });
    assert.equal(port, null, 'fail closed: an unauthorized type is never registered');
  });

  test('the fact is POLICY-ADMITTED only — never lexically discovered (review find)', async () => {
    // The disclaimer sentence inside the fact chunk ("calculated from the
    // résumé — role, location, skills and years of experience…") is a BM25
    // keyword magnet: before policyOnly scoring it ranked #2 on "tell me about
    // my experience" and "what are my skills" in a real-DB probe, wasting an
    // evidence slot and injecting salary noise into non-salary answers.
    const port = lfwPort([RESUME_DOC, JD_DOC, FACT_DOC]);
    for (const q of [
      'tell me about my experience', 'what are my skills',
      'do I meet the job requirements', 'tell me about my projects',
    ]) {
      const r = await port.retrieve({ decision: lfwDecision(q) });
      assert.ok(!r.evidence.some((e) => e.sourceType === 'PROFILE_FACT'),
        `"${q}" is not a compensation question — the derived salary fact must not consume an evidence slot`);
    }
    // …and the question it exists for still resolves it.
    const salary = await port.retrieve({ decision: lfwDecision('what is my expected salary') });
    assert.ok(salary.evidence.some((e) => e.sourceType === 'PROFILE_FACT'),
      'policy admission must still fire on a genuine compensation question');
  });

  test('a malformed or absent estimate yields no source, never a throw', () => {
    for (const bad of [{}, { salary_estimate: null }, { salary_estimate: { min: 1 } }, { salary_estimate: { min: 'x', max: 'y' } }]) {
      assert.deepEqual(renderProfileSections('fact', bad), [],
        'an incomplete estimate must render nothing rather than a half-formed number');
    }
  });
});
