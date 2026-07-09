// node:test — JD / Resume JIT pipeline fix (2026-07-07).
//
// Verifies the six behaviors the fix ships, using GENERALIZED fixtures and
// paraphrases — never the production benchmark strings, JD title, company,
// project names, or the user's resume. Success is measured by:
//   • the routed answer type + effective context layers (jd/resume present)
//   • source-tagged EvidenceItems reaching the JIT prompt (jdEvidenceCount)
//   • the rendered prompt containing <target_job_evidence> / <candidate_resume_evidence>
// NOT by selectedContextLayers alone.
//
// Anti-hardcoding: a mutation block renames the JD title/technologies, removes
// salary, renames projects/companies, changes the CGPA, and paraphrases every
// question — routing + evidence behavior must hold with ZERO code change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, rel)).href);
const { planAnswer } = await load('../../../dist-electron/electron/llm/AnswerPlanner.js');
const mpi = await load('../../../dist-electron/electron/llm/manualProfileIntelligence.js');
const { buildProfileJitPrompt } = await load('../../../dist-electron/electron/llm/ProfileJitPromptBuilder.js');

// ── Generic synthetic fixtures (NOT the user's real data) ───────────────────
const baseProfile = () => ({
  identity: { name: 'Jordan Vale' },
  experience: [
    { role: 'Backend Engineer', company: 'Cloudform', bullets: ['Built Go APIs', 'Scaled Postgres'] },
    { role: 'Software Intern', company: 'Beacon Labs', bullets: ['Shipped a data pipeline'] },
  ],
  projects: [
    { name: 'PayFlow', description: 'payments service', technologies: ['Go', 'Postgres', 'Kafka'] },
    { name: 'GridSense', description: 'iot dashboard', technologies: ['React', 'Node'] },
  ],
  skills_flat: ['Go', 'Postgres', 'Kafka', 'Docker', 'React'],
  education: [{ institution: 'Riverside University', degree: 'BSc CS', cgpa: '3.8' }],
});
const baseJd = () => ({
  title: 'Data Platform Engineer',
  company: 'NorthStar',
  description_summary: 'Own the data ingestion and warehouse layer.',
  level: 'Senior',
  employment_type: 'Full-time',
  requirements: ['5+ years data engineering', 'Strong SQL', 'Airflow experience', 'Python'],
  responsibilities: ['Design ETL pipelines', 'Own data quality', 'Mentor juniors'],
  technologies: ['SQL', 'Python', 'Airflow', 'Snowflake'],
  keywords: ['ETL', 'data-warehouse', 'orchestration'],
  nice_to_haves: ['dbt', 'Spark'],
  // NOTE: no compensation_hint / relocation → absence cases.
});

const eff = (plan) => {
  const forb = new Set(plan.forbiddenContextLayers);
  return plan.requiredContextLayers.filter((l) => !forb.has(l));
};
const route = (q) => {
  const plan = planAnswer({ question: q, source: 'manual_input', hasCandidateProfile: true, hasJobDescription: true });
  const layers = eff(plan);
  return { type: plan.answerType, layers, jd: layers.includes('jd'), resume: layers.includes('resume') };
};
const evidenceFor = (q, profile, jd) => {
  const plan = planAnswer({ question: q, source: 'manual_input', hasCandidateProfile: true, hasJobDescription: true });
  const sel = mpi.selectManualProfileEvidence({ question: q, profile, jobDescription: jd, source: 'manual_input', answerType: plan.answerType });
  const diag = mpi.computeEvidenceDiagnostics(sel);
  const prompt = sel ? buildProfileJitPrompt({ question: q, answerType: plan.answerType, answerShape: plan.answerType, sourceOwner: sel.sourceOwner, evidence: sel }) : null;
  return { plan, sel, diag, userPrompt: prompt?.userPrompt || '' };
};

// ══ Group 1: JD-source routing (jd routed, resume NOT required) ══════════════
describe('JD-source routing — jd layer routed, no candidate cue', () => {
  const cases = [
    'what kind of candidate is this job description looking for?',
    'what does this role require?',
    'what are the top skills required for this role?',
    'what responsibilities are listed in the jd?',
    'based only on the jd, what kind of engineer do they want?',
    'does the jd mention salary?',
    'does this role require relocation?',
    'how many years of experience does the role require?',
  ];
  for (const q of cases) {
    test(`"${q}" → jd routed`, () => {
      const r = route(q);
      assert.ok(r.jd, `expected jd layer, got type=${r.type} layers=${r.layers}`);
      assert.ok(/^jd_/.test(r.type), `expected a jd_* type, got ${r.type}`);
    });
  }
});

// ══ Group 2: JD-source EVIDENCE reaches the JIT prompt ═══════════════════════
describe('JD-source evidence — source-tagged JD items in the prompt', () => {
  for (const q of ['what does this role require?', 'what technologies does the jd mention?', 'what are the responsibilities in this jd?']) {
    test(`"${q}" → jdEvidenceCount>0 and <target_job_evidence> rendered`, () => {
      const { diag, userPrompt } = evidenceFor(q, baseProfile(), baseJd());
      assert.ok((diag?.jdEvidenceCount ?? 0) > 0, `expected jdEvidenceCount>0, got ${diag?.jdEvidenceCount}`);
      assert.match(userPrompt, /<target_job_evidence/);
      assert.match(userPrompt, /profile_jd/);
    });
  }
  test('requirements + technologies fields are present as evidence', () => {
    const { userPrompt } = evidenceFor('what does this role require?', baseProfile(), baseJd());
    assert.match(userPrompt, /jd\.requirements/);
    assert.match(userPrompt, /jd\.technologies/);
  });
});

// ══ Group 3: JD absence handled honestly (salary/relocation) ════════════════
describe('JD fact absence — honest "not specified", never negotiation, never "upload"', () => {
  test('salary fact routes jd_fact (not negotiation) and the prompt guides honest absence', () => {
    const r = route('does the jd mention salary?');
    assert.equal(r.type, 'jd_fact_answer');
    assert.notEqual(r.type, 'negotiation_answer');
    assert.ok(r.jd, 'jd layer routed');
    const { userPrompt } = evidenceFor('does the jd mention salary?', baseProfile(), baseJd());
    // The answer-contract rule must instruct the model to report the JD does not
    // specify the field (honest absence), rather than refusing.
    assert.match(userPrompt, /does not specify|not present/i);
    // The JD IS present as evidence — the rule set explicitly forbids claiming
    // the JD is not loaded.
    assert.match(userPrompt, /not loaded|do not ask for an upload/i);
  });
  test('a JD with a completely empty structured body → missingInfo for the fact', () => {
    const emptyJd = { title: '', company: '' };
    const { diag } = evidenceFor('does the jd mention salary?', baseProfile(), emptyJd);
    assert.ok(diag?.missingInfoDetected, 'empty JD → missingInfoDetected');
  });
  test('explicit "how should I negotiate salary" stays negotiation', () => {
    const r = route('how should i negotiate the salary for this role?');
    assert.equal(r.type, 'negotiation_answer');
  });
});

// ══ Group 4: resume+JD routing (BOTH layers) ════════════════════════════════
describe('resume+JD routing — both resume and jd layers present', () => {
  const cases = [
    'why am i a good fit for this role?',
    'which parts of my resume best match this jd?',
    'which of my projects is most relevant for this jd?',
    'which internship should i highlight for this role?',
    'what are my gaps for this jd?',
    'tell me about yourself for this role',
    'walk me through my resume with this jd in mind',
    'how would you explain your lack of experience in some jd requirements?',
  ];
  for (const q of cases) {
    test(`"${q}" → resume AND jd routed`, () => {
      const r = route(q);
      assert.ok(r.jd, `expected jd layer for "${q}", got layers=${r.layers}`);
      assert.ok(r.resume, `expected resume layer for "${q}", got layers=${r.layers}`);
    });
  }
  test('resume+JD evidence keeps JD and resume in SEPARATE blocks', () => {
    const { diag, userPrompt } = evidenceFor('which of my projects is most relevant for this jd?', baseProfile(), baseJd());
    assert.ok((diag?.jdEvidenceCount ?? 0) > 0, 'jd evidence present');
    assert.ok((diag?.resumeEvidenceCount ?? 0) > 0, 'resume evidence present');
    assert.match(userPrompt, /<target_job_evidence/);
    assert.match(userPrompt, /<candidate_resume_evidence/);
    assert.match(userPrompt, /source_separation_rules/);
  });
});

// ══ Group 5: resume-only regression (jd NOT included unless asked) ══════════
describe('resume-only regression — no JD leak, candidate route preserved', () => {
  const cases = [
    ['what is my name?', 'identity_answer'],
    ['what companies have i worked at?', 'experience_answer'],
    ['what are my skills?', 'skills_answer'],
  ];
  for (const [q, want] of cases) {
    test(`"${q}" → ${want}, resume yes / jd no`, () => {
      const r = route(q);
      assert.equal(r.type, want, `got ${r.type}`);
      assert.ok(r.resume, 'resume layer present');
      assert.ok(!r.jd, 'jd layer NOT present for a plain profile question');
    });
  }
  test('"what is my cgpa?" routes a profile fact (not unknown)', () => {
    const r = route('what is my cgpa?');
    assert.notEqual(r.type, 'unknown_answer');
    assert.ok(!r.jd, 'no jd for a cgpa question');
  });
});

// ══ Group 6: coding regression — no profile/JD leak ═════════════════════════
describe('coding regression — profile and JD forbidden', () => {
  for (const q of ['write a function to reverse a linked list', 'explain how tcp differs from udp', 'how would you design a rate limiter']) {
    test(`"${q}" → no resume, no jd`, () => {
      const r = route(q);
      assert.ok(!r.resume, `resume must be forbidden for "${q}"`);
      assert.ok(!r.jd, `jd must be forbidden for "${q}"`);
    });
  }
});

// ══ Group 7: telemetry honesty — evidence, not layers ═══════════════════════
describe('diagnostics — hasProfileJDBlock reflects EVIDENCE, not selectedContextLayers', () => {
  test('empty JD (no structured content) → jdEvidenceCount 0 even if jd routed', () => {
    const emptyJd = { title: '', company: '' };
    const { diag } = evidenceFor('what does this role require?', baseProfile(), emptyJd);
    // No structured JD content → no JD evidence items, so hasProfileJDBlock is false
    // even though the answer type routes the jd layer. (This is the core anti-
    // "selectedContextLayers is proof" invariant.)
    assert.equal(diag?.jdEvidenceCount ?? 0, 0);
    assert.equal(diag?.hasProfileJDBlock, false);
  });
  test('non-degenerate JD → jdEvidenceCount>0 and hasProfileJDBlock true', () => {
    const { diag } = evidenceFor('what does this role require?', baseProfile(), baseJd());
    assert.ok((diag?.jdEvidenceCount ?? 0) > 0);
    assert.equal(diag?.hasProfileJDBlock, true);
  });
});

// ══ Group 8: ANTI-HARDCODING — mutate fixtures, behavior must hold ══════════
describe('anti-hardcoding — renamed/paraphrased fixtures behave identically', () => {
  const mutated = () => {
    const p = baseProfile();
    p.identity.name = 'Sam Okoro';
    p.projects = [{ name: 'Quokka', description: 'analytics tool', technologies: ['Rust', 'ClickHouse'] }];
    p.experience = [{ role: 'Platform Engineer', company: 'Vantage', bullets: ['Owned CI/CD'] }];
    p.education = [{ institution: 'Northgate', degree: 'BSc', cgpa: '3.2' }];
    return p;
  };
  const mutatedJd = () => ({
    title: 'Machine Learning Engineer',            // renamed
    company: 'Helios',
    description_summary: 'Ship ML models to production.',
    requirements: ['PyTorch', 'MLOps', 'Distributed training'],   // renamed
    responsibilities: ['Train models', 'Own the serving stack'],
    technologies: ['PyTorch', 'Kubernetes', 'Ray'],               // renamed
    keywords: ['ml', 'serving'],
    // salary/relocation still absent
  });

  test('JD-only question still routes jd + emits jd evidence after rename', () => {
    const { diag, userPrompt, plan } = evidenceFor('what does this role require?', mutated(), mutatedJd());
    assert.ok(/^jd_/.test(plan.answerType));
    assert.ok((diag?.jdEvidenceCount ?? 0) > 0);
    assert.match(userPrompt, /PyTorch|MLOps|Distributed training/);  // the RENAMED requirements
  });
  test('resume+JD selector still routes both layers after project rename', () => {
    const { diag } = evidenceFor('which of my projects is most relevant for this jd?', mutated(), mutatedJd());
    assert.ok((diag?.jdEvidenceCount ?? 0) > 0);
    assert.ok((diag?.resumeEvidenceCount ?? 0) > 0);
  });
  test('salary absence honest after mutation (still no comp field)', () => {
    const { plan, userPrompt } = evidenceFor('does the jd mention salary?', mutated(), mutatedJd());
    assert.equal(plan.answerType, 'jd_fact_answer');
    // The mutated JD still has no comp field, so the prompt must guide an honest
    // "does not specify" absence and never claim the JD is unloaded.
    assert.match(userPrompt, /does not specify|not present/i);
  });
  test('paraphrases of the same intent route the same way', () => {
    for (const q of ['what does the role need?', 'what is required for this position?', 'what does this job require?']) {
      const r = route(q);
      assert.ok(r.jd, `paraphrase "${q}" should route jd, got ${r.type}`);
    }
  });
});
