// electron/context-intelligence/__tests__/ProfileDerivedEvidence2026_09_30.test.mjs
//
// Derived-evidence hygiene (2026-09-30). Profile Intelligence evidence must be
// the candidate's own documents, not content a model wrote about them:
//   * the résumé extractor may GENERATE a project description ("if a description
//     is not explicitly provided, generate a concise 1-sentence summary");
//   * the extractor fills missing identity with placeholders ("Unknown Candidate");
//   * AOT artifact cards (intro, pivot scripts, mock-answer keys, culture
//     mapping, negotiation) are model output about the candidate;
//   * the salary ESTIMATE was served as PROFILE_FACT — first-person authority.
// Rule under test: a derived field is kept only when the raw résumé text
// supports it (every number present, ≥ 75% of distinctive words present).
//
// Run: npm run build:electron && node --test electron/context-intelligence/__tests__/ProfileDerivedEvidence2026_09_30.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.cwd(), 'dist-electron/electron');
const base = path.join(dist, 'context-intelligence');
const {
  buildSupportIndex, assessDerivedSupport, stripUnsupportedDerivedResumeFields,
  isGeneratedArtifactCard, isExtractorPlaceholder,
} = await import(pathToFileURL(path.join(base, 'retrieval/profile-derived-support.js')).href);
const { createProfileRetrievalPort, renderProfileSections } =
  await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { resolveModePolicy } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const requireDist = createRequire(import.meta.url);
const { collectV3ProfileSources } = requireDist(path.join(dist, 'services/knowledge/v3ProfileSources.js'));
const { buildManualProfileEvidenceRoute } = requireDist(path.join(dist, 'llm/profileAnswerBackend.js'));

// The candidate's own words. The ledger project has a real description line;
// the budget app has only a name and a stack, so any description of it is
// the extractor's invention.
const RAW_RESUME = `Asha Menon
Backend Engineer — Kochi, India

EXPERIENCE
Backend Engineer, Finlytics (2022 – Present)
- Built a double-entry ledger service in Go processing 1.2M transactions a day
- Cut settlement reconciliation time from 6 hours to 40 minutes

PROJECTS
Ledgerline — Open-source double-entry ledger service written in Go with Postgres; 16,000 downloads.
BudgetBee — React Native, Firebase
`;

const SUPPORTED_DESC = 'Open-source double-entry ledger service in Go and Postgres with 16k downloads.';
const INVENTED_DESC = 'A mobile budgeting app that helps students track monthly spending and savings goals.';
const INVENTED_NUMBER_DESC = 'Double-entry ledger service in Go with Postgres; 50,000 downloads.';

const STRUCTURED = {
  identity: { name: 'Asha Menon', location: 'Kochi, India', summary: '' },
  experience: [{ company: 'Finlytics', role: 'Backend Engineer', start_date: '2022-01', end_date: null,
    bullets: ['Built a double-entry ledger service in Go processing 1.2M transactions a day'] }],
  projects: [
    { name: 'Ledgerline', description: SUPPORTED_DESC, technologies: ['Go', 'Postgres'] },
    { name: 'BudgetBee', description: INVENTED_DESC, technologies: ['React Native', 'Firebase'] },
  ],
  skills: { languages: ['Go'], frameworks: ['React Native'] },
};

describe('assessDerivedSupport — the rule', () => {
  const index = buildSupportIndex(RAW_RESUME);

  test('a description in the résumé\'s own words is supported (numeral notation does not matter)', () => {
    const v = assessDerivedSupport(SUPPORTED_DESC, index);
    assert.equal(v.supported, true, JSON.stringify(v));
  });

  test('a description built from "context clues" is not', () => {
    const v = assessDerivedSupport(INVENTED_DESC, index);
    assert.equal(v.supported, false);
    assert.equal(v.reason, 'low_coverage');
  });

  test('one number the résumé never states rejects the field, whatever the word coverage', () => {
    const v = assessDerivedSupport(INVENTED_NUMBER_DESC, index);
    assert.equal(v.supported, false);
    assert.equal(v.reason, 'unsupported_number');
  });

  test('no raw text → nothing can be verified → not supported (fail closed)', () => {
    assert.deepEqual(assessDerivedSupport(SUPPORTED_DESC, buildSupportIndex(null)).reason, 'no_raw_text');
    assert.equal(buildSupportIndex('   '), null);
  });

  test('extractor placeholders are recognised; real values are not', () => {
    for (const p of ['Unknown Candidate', 'unknown role', ' Unknown Location ']) assert.equal(isExtractorPlaceholder(p), true, p);
    for (const v of ['Asha Menon', 'Unknown Worlds Entertainment', '']) assert.equal(isExtractorPlaceholder(v), false, v);
  });

  test('AOT artifact cards are recognised by provenance or type', () => {
    assert.equal(isGeneratedArtifactCard({ type: 'artifact_intro' }), true);
    assert.equal(isGeneratedArtifactCard({ type: 'candidate_project', generatedFrom: 'aot_artifact' }), true);
    assert.equal(isGeneratedArtifactCard({ type: 'candidate_project', generatedFrom: 'structured_profile' }), false);
  });
});

describe('stripUnsupportedDerivedResumeFields', () => {
  test('keeps the supported description, drops the invented one, leaves everything else', () => {
    const out = stripUnsupportedDerivedResumeFields(STRUCTURED, RAW_RESUME);
    assert.equal(out.projects[0].description, SUPPORTED_DESC);
    assert.equal('description' in out.projects[1], false);
    assert.equal(out.projects[1].name, 'BudgetBee');
    assert.deepEqual(out.projects[1].technologies, ['React Native', 'Firebase']);
    assert.deepEqual(out.experience, STRUCTURED.experience);
    assert.equal(STRUCTURED.projects[1].description, INVENTED_DESC, 'input is not mutated');
  });

  test('placeholder identity values are blanked', () => {
    const out = stripUnsupportedDerivedResumeFields({ identity: { name: 'Unknown Candidate', location: 'Unknown Location' } }, RAW_RESUME);
    assert.equal(out.identity.name, '');
    assert.equal(out.identity.location, '');
  });

  test('without raw text, descriptions cannot be verified and are dropped', () => {
    const out = stripUnsupportedDerivedResumeFields(STRUCTURED, null);
    assert.ok(out.projects.every((p) => !('description' in p)));
  });
});

// ── V3 profile port ─────────────────────────────────────────────────────────

const LFW = resolveModePolicy('looking-for-work');
const lfwDecision = (q) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId: 'looking-for-work', scope: { userId: 'local' }, sessionId: 'pde-s1',
  manualQuestion: q,
});
const RESUME_DOC = (over = {}) => ({
  kind: 'resume', sourceId: 'psrc_resume_pde', versionId: 'rv1',
  fileName: 'Candidate Resume (Profile Intelligence)', structured: STRUCTURED, rawText: RAW_RESUME,
  cards: [
    { id: 'c1', type: 'candidate_project', title: 'Ledgerline', body: `${SUPPORTED_DESC}\nTechnologies: Go, Postgres.`, generatedFrom: 'structured_profile' },
    { id: 'c2', type: 'candidate_project', title: 'BudgetBee', body: `${INVENTED_DESC}\nTechnologies: React Native, Firebase.`, generatedFrom: 'structured_profile' },
    { id: 'c3', type: 'artifact_intro', title: '60-Second Intro', body: 'I am a passionate engineer who loves mentoring junior developers and led a team of twelve.', generatedFrom: 'aot_artifact' },
    { id: 'c4', type: 'artifact_mock_questions', title: 'Mock Interview Questions', body: 'Q: Tell me about a conflict. Suggested answer: I resolved a dispute with my manager at Finlytics.' },
  ],
  ...over,
});
const port = (docs) => createProfileRetrievalPort({
  docs, allowedSourceTypes: LFW.allowedSourceTypes, profileSources: LFW.profileSources, userId: 'local',
});
const allEvidence = async (questions) => {
  const p = port([RESUME_DOC()]);
  const out = [];
  for (const q of questions) out.push(...(await p.retrieve({ decision: lfwDecision(q) })).evidence);
  return out;
};

describe('V3 profile port serves only document-supported derived content', () => {
  const QUESTIONS = ['tell me about my projects', 'what is BudgetBee', 'tell me about BudgetBee',
    'tell me about yourself', 'tell me about a conflict you resolved', 'what is Ledgerline'];

  test('the supported description is evidence; the invented one never is', async () => {
    const ev = await allEvidence(QUESTIONS);
    assert.ok(ev.some((e) => e.content.includes('Open-source double-entry ledger service')), 'supported description kept');
    assert.ok(!ev.some((e) => /budgeting app|monthly spending|savings goals/i.test(e.content)),
      'the generated BudgetBee description must not reach evidence (section OR card)');
  });

  test('AOT artifact cards (intro, mock answers) are never evidence', async () => {
    const ev = await allEvidence(QUESTIONS);
    assert.ok(!ev.some((e) => /passionate engineer|team of twelve|Suggested answer/i.test(e.content)));
  });

  test('the raw résumé text stays intact and reachable (lossless sections)', async () => {
    const ev = await allEvidence(['what did I build at Finlytics', 'tell me about BudgetBee']);
    assert.ok(ev.some((e) => e.content.includes('1.2M transactions')), 'raw experience line reachable');
    assert.ok(ev.some((e) => /BudgetBee/.test(e.content)), 'the project itself (name + stack) is still evidence');
  });

  test('the section renderer itself is unchanged: hygiene lives at the port boundary', () => {
    const sections = renderProfileSections('resume', STRUCTURED);
    assert.ok(sections.some((s) => s.text.includes(INVENTED_DESC)), 'renderProfileSections is a pure renderer');
  });
});

describe('the salary estimate never becomes PROFILE_FACT', () => {
  const ESTIMATE = { currency: 'INR', min: 1800000, max: 2600000, confidence: 'medium', role: 'Backend Engineer', location: 'Kochi' };
  const orchestrator = {
    activeResume: { id: 'r1', structured_data: STRUCTURED, raw_text: RAW_RESUME },
    activeJD: null,
    getResumeSalaryEstimate: () => ESTIMATE,
  };

  test('the collector serves no fact source even when an estimate exists', () => {
    const collected = collectV3ProfileSources(orchestrator);
    assert.ok(collected.docs.some((d) => d.kind === 'resume'));
    assert.ok(!collected.docs.some((d) => d.kind === 'fact'), 'no derived-fact doc');
    assert.equal(collected.counts.profileFact, 0);
    assert.ok(!collected.resolved.some((r) => r.role === 'profile_fact'));
  });

  test('a caller that still passes one gets no PROFILE_FACT evidence and no band in any evidence', async () => {
    const fact = { kind: 'fact', sourceId: 'psrc_fact', versionId: 'f1', fileName: 'facts', structured: { salary_estimate: ESTIMATE } };
    const decision = lfwDecision('what is my expected salary');
    assert.ok(decision.retrievalPlan.sourceTypes.includes('PROFILE_FACT'));
    const r = await port([RESUME_DOC(), fact]).retrieve({ decision });
    assert.ok(!r.evidence.some((e) => e.sourceType === 'PROFILE_FACT'));
    assert.ok(!r.evidence.some((e) => /1,800,000|2,600,000|1800000/.test(e.content)));
  });
});

describe('legacy JIT evidence route applies the same rule', () => {
  test('an invented project description is not selected; the project and the supported description are', () => {
    const { route } = buildManualProfileEvidenceRoute({
      question: 'what projects have you worked on?',
      orchestrator: { activeResume: { structured_data: STRUCTURED, raw_text: RAW_RESUME }, activeJD: null },
      source: 'manual_input',
    });
    assert.ok(route, 'the project question must produce a route (else this test is vacuous)');
    const text = JSON.stringify(route.items);
    assert.match(text, /BudgetBee/, 'the project itself is still evidence');
    assert.match(text, /Open-source double-entry ledger service/, 'the supported description is kept');
    assert.doesNotMatch(text, /budgeting app|monthly spending/i, 'the invented description is not');
  });
});

// Every legacy reader that turns the structured résumé into evidence goes
// through the same filter (source-level, like the repo's other wiring tests).
describe('wiring: legacy structured-résumé evidence readers use the filter', () => {
  const fs = requireDist('node:fs');
  const src = (rel) => fs.readFileSync(path.resolve(process.cwd(), 'electron', rel), 'utf8');
  const WRAP = /stripUnsupportedDerivedResumeFields\(\s*\(\w+ as any\)\?\.activeResume\?\.structured_data \?\? null,\s*\(\w+ as any\)\?\.activeResume\?\.raw_text,?\s*\)/;
  test('IntelligenceEngine: WTA coordinator snapshot and WTA evidence JIT', () => {
    const ie = src('IntelligenceEngine.ts');
    assert.match(ie, new RegExp(`const snapshotProfileFacts = ${WRAP.source}`));
    assert.match(ie, new RegExp(`const resume = ${WRAP.source}`));
  });
  test('ipcHandlers: manual coordinator arm and profile validator/repair', () => {
    const ipc = src('ipcHandlers.ts');
    assert.match(ipc, new RegExp(`const activeResumeStructured = ${WRAP.source}`));
    assert.match(ipc, new RegExp(`const activeResume = ${WRAP.source}\\s*;\\s*const activeJD`));
  });
  test('profileAnswerBackend: manual JIT route', () => {
    assert.match(src('llm/profileAnswerBackend.ts'), /stripUnsupportedDerivedResumeFields\(\s*orchestrator\?\.activeResume\?\.structured_data \?\? null,\s*orchestrator\?\.activeResume\?\.raw_text,?\s*\)/);
  });
});
