// electron/llm/__tests__/ProfileEvidenceValidator.test.mjs
//
// Phase 6: deterministic, low-latency evidence validation for profile answers.
// Catches FABRICATED specifics (metrics/%/$, companies) that are not present in
// the grounded evidence — e.g. an invented "25% retention" or "$2M revenue" — and
// composes the existing perspective/identity/refusal/leak checks. No LLM.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { validateProfileEvidence } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/profileEvidenceValidator.js')).href
);

const EVIDENCE = `<candidate_profile>
Name: Evin John
EXPERIENCE
  - Founder at Natively (2024-01 - Present)
      • Built a real-time meeting copilot.
  - Software Engineer Intern at Aetherbot AI (2023-05 - 2023-08)
      • Scaled a pixel-streaming pipeline on AWS; drove a 25% increase in customer retention.
PROJECTS
  - ABTest-Framework: A/B testing library. React, Node.js
SKILLS
  Programming Languages: TypeScript, Python, Go
</candidate_profile>`;

const plan = (over = {}) => ({
  answerType: 'experience_answer',
  outputPerspective: 'first_person_candidate',
  voicePerspective: 'first_person_candidate',
  profileContextPolicy: 'required',
  forbiddenContextLayers: ['negotiation'],
  ...over,
});

const run = (answer, planOver, evidence = EVIDENCE) =>
  validateProfileEvidence({ answer, plan: plan(planOver), evidence, profileAvailable: true, candidateDirected: true });

describe('Phase 6: evidence validator — fabricated metrics', () => {
  test('a GROUNDED metric (25% retention, present in evidence) passes', () => {
    const r = run('At Aetherbot AI I drove a 25% increase in customer retention.');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });

  test('an UNSUPPORTED percentage (40% not in evidence) is flagged', () => {
    const r = run('I improved retention by 40%.');
    assert.ok(r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
    assert.equal(r.ok, false);
  });

  test('an UNSUPPORTED dollar metric ($2M revenue not in evidence) is flagged', () => {
    const r = run('My work generated $2M in new revenue.');
    assert.ok(r.errorCodes.includes('unsupported_metric'));
  });

  test('an UNSUPPORTED multiplier (10x faster) is flagged', () => {
    const r = run('I made the pipeline 10x faster.');
    assert.ok(r.errorCodes.includes('unsupported_metric'));
  });

  test('repair instruction names the unsupported-number rule', () => {
    const r = run('I improved retention by 40%.');
    assert.match(r.repairInstruction, /number|metric|unsupported|soften|remove/i);
  });

  test('small bare integers / year-counts are NOT flagged (legitimate inference)', () => {
    const r = run('I have worked on 2 internships over the last 3 years.');
    assert.ok(!r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
  });

  test('metrics are NOT checked for technical (forbidden) answers — O(n) etc. are fine', () => {
    const r = run('The time complexity is O(n) and it runs in 100ms.', {
      answerType: 'technical_concept_answer',
      voicePerspective: 'assistant_explanation',
      profileContextPolicy: 'forbidden',
      forbiddenContextLayers: ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'],
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'));
  });
});

describe('Phase 6: evidence validator — fabricated companies', () => {
  test('a GROUNDED company (Natively, Aetherbot) passes', () => {
    const r = run('I worked at Natively as the founder.');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });

  test('an UNSUPPORTED company ("I worked at Google") is flagged', () => {
    const r = run('I worked at Google on search infrastructure.');
    assert.ok(r.errorCodes.includes('unsupported_company') || r.violations.some(v => v.code === 'unsupported_company'),
      JSON.stringify(r.violations));
  });
});

describe('Phase 6: evidence validator — composes perspective/identity/refusal checks', () => {
  test('assistant-identity leak still caught', () => {
    const r = run("I am Natively, an AI assistant.", { answerType: 'identity_answer' });
    assert.ok(r.errorCodes.includes('assistant_identity_leak'));
  });

  test('false "no access" refusal still caught when profile present', () => {
    const r = run("I don't have access to your resume.", { answerType: 'identity_answer' });
    assert.ok(r.errorCodes.includes('false_no_access_refusal'));
  });

  test('profile leak in a coding answer still caught', () => {
    const r = run('Looking at my resume, the job description says use a hashmap.', {
      answerType: 'coding_question_answer',
      voicePerspective: 'assistant_explanation',
      profileContextPolicy: 'forbidden',
      forbiddenContextLayers: ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'],
    });
    assert.ok(r.errorCodes.includes('profile_in_generic_answer'));
  });

  test('a clean grounded answer with no specifics passes', () => {
    const r = run('I have experience building real-time systems and scaling pipelines.');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
});

describe('Phase 6: negotiation answers are EXEMPT from metric checks', () => {
  // Salary figures in a negotiation answer come from the negotiation strategy,
  // NOT the resume evidence block — they must not be flagged as fabricated.
  const negPlan = {
    answerType: 'negotiation_answer',
    outputPerspective: 'first_person_candidate',
    voicePerspective: 'first_person_candidate',
    profileContextPolicy: 'allowed',
    forbiddenContextLayers: ['reference_files'],
  };
  test('a salary figure ($200,000) not in resume evidence is NOT flagged', () => {
    const r = validateProfileEvidence({
      answer: 'I am targeting a base salary in the range of $200,000.',
      plan: negPlan, evidence: EVIDENCE, profileAvailable: true, candidateDirected: true,
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
    assert.equal(r.ok, true);
  });
  test('120 LPA not in evidence is NOT flagged for negotiation', () => {
    const r = validateProfileEvidence({
      answer: 'My expected range is around 120 LPA.',
      plan: negPlan, evidence: EVIDENCE, profileAvailable: true, candidateDirected: true,
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'));
  });
});

describe('Phase 6: metric shapes — decimals, commas, non-$ currency', () => {
  test('unsupported decimal percentage (3.5%) flagged', () => {
    assert.ok(run('I improved it by 3.5%.').errorCodes.includes('unsupported_metric'));
  });
  test('unsupported comma-thousands ($1,200,000) flagged', () => {
    assert.ok(run('I generated $1,200,000 in revenue.').errorCodes.includes('unsupported_metric'));
  });
  test('unsupported euro magnitude (€500k) flagged', () => {
    assert.ok(run('I drove €500k in new business.').errorCodes.includes('unsupported_metric'));
  });
  test('magnitude-equivalent grounded metric PASSES ($2M answer vs "2,000,000" evidence)', () => {
    const ev = EVIDENCE + '\n      • grew revenue to 2,000,000 dollars.';
    const r = validateProfileEvidence({
      answer: 'I grew revenue to $2M.',
      plan: plan(), evidence: ev, profileAvailable: true, candidateDirected: true,
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
  });
  test('reverse magnitude equivalence ("150k" answer vs "150,000" evidence) PASSES', () => {
    const ev = EVIDENCE + '\n      • managed a 150,000 user base.';
    const r = validateProfileEvidence({
      answer: 'I managed 150k users.',
      plan: plan(), evidence: ev, profileAvailable: true, candidateDirected: true,
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
  });

  test('GROUNDED comma/decimal metric round-trips and PASSES', () => {
    // evidence contains the exact figure with a comma → must not be flagged.
    const ev = EVIDENCE + '\n      • grew ARR to $1,200,000 and cut latency 3.5%.';
    const r = validateProfileEvidence({
      answer: 'I grew ARR to $1,200,000 and cut latency by 3.5%.',
      plan: plan(), evidence: ev, profileAvailable: true, candidateDirected: true,
    });
    assert.ok(!r.errorCodes.includes('unsupported_metric'), JSON.stringify(r.violations));
  });
});

describe('Phase 6: latency — deterministic & fast', () => {
  test('validates in well under 5ms', () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) run('I improved retention by 40% at Google.');
    const ms = Number(process.hrtime.bigint() - start) / 1e6 / 200;
    assert.ok(ms < 5, `avg ${ms.toFixed(3)}ms per validation`);
  });
});
