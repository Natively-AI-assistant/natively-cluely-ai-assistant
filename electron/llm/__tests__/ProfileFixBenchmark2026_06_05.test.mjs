// electron/llm/__tests__/ProfileFixBenchmark2026_06_05.test.mjs
//
// Regression guard for the Profile Intelligence FIX round (2026-06-05) driven by
// the real-backend benchmark. Each case is a phrasing the benchmark caught
// misrouting (mostly to unknown_answer) and that the AnswerPlanner / manual
// fast-path fixes now handle. Covers Phases 2,3,6,8,9 (routing), the safety
// invariants (coding/sales/lecture forbid profile; negotiation only for comp),
// and Phase 10 (single-project deterministic fast path).
//
// Routing equivalence: where two answer types are interchangeable for grounding
// (project≡project_followup≡experience≡behavioral; profile_fact≡skills≡
// skill_experience≡identity), either is accepted — the benchmark scorer uses the
// same equivalence classes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);
const mpi = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);

const plan = (q, source = 'manual_input', speaker = 'user') =>
  planAnswer({ question: q, source, speakerPerspective: speaker });

const EQUIV = [
  ['coding_question_answer', 'dsa_question_answer'],
  ['technical_concept_answer', 'system_design_answer', 'debugging_question_answer'],
  ['project_answer', 'project_followup_answer', 'experience_answer', 'behavioral_interview_answer'],
  ['profile_fact_answer', 'skills_answer', 'skill_experience_answer', 'experience_answer', 'identity_answer'],
  ['skill_experience_answer', 'skills_answer'],
];
const equiv = (expected, actual) => {
  if (expected === actual) return true;
  return EQUIV.some((c) => c.includes(expected) && c.includes(actual));
};
const assertRoute = (q, expected) => {
  const a = plan(q).answerType;
  assert.ok(equiv(expected, a), `"${q}" → expected ${expected} (or equiv), got ${a}`);
};

// ── Phase 2: identity / intro fallback (no longer unknown) ───────────────────
describe('fix: identity & intro', () => {
  for (const q of [
    'Give me a quick introduction.', 'Just to confirm, what should I call you?',
    'Can you give me your background in 30 seconds?', 'How would you describe yourself professionally?',
    'Can you summarize who you are as a candidate?',
  ]) test(`"${q}" → identity`, () => assertRoute(q, 'identity_answer'));
});

// ── Phase 2: current role / background / education ───────────────────────────
describe('fix: role / background / education', () => {
  test('what do you currently do', () => assertRoute('What do you currently do?', 'experience_answer'));
  test('where did you study', () => assertRoute('Where did you study?', 'profile_fact_answer'));
  // "What role are you applying for?" is a factual lookup of the target role —
  // profile_fact (or jd_fit) are both acceptable; it must be a profile answer,
  // not unknown.
  test('what role are you applying for', () => {
    const a = plan('What role are you applying for?').answerType;
    assert.ok(a === 'profile_fact_answer' || a === 'jd_fit_answer', `→ ${a}`);
  });
});

// ── Phase 6: JD-fit — every benchmark phrasing must route to jd_fit ──────────
describe('fix: JD-fit routing', () => {
  for (const q of [
    'Why do you want this job?', 'What excites you about this role?',
    'How can you contribute to this team?', 'What value can you bring to this role?',
    'Do you fit what this Data Analyst position needs?', 'How good are you for this job?',
    'Are you good for this job?', 'Why you for this job, not generally, this one?',
    'You said full stack, but this is data analyst, connect it.',
    'Natively is not data analysis, so why is it relevant?',
    'Full-stack is different from data analyst, explain the connection.',
    'Your experience seems engineering-heavy, why data?',
    "You don't seem like pure analyst, convince me.",
    'If we need SQL daily, how ready are you?', 'If we need Python automation, how ready are you?',
    'Convince me you are right for this role.', 'In what ways are you a match for this job?',
    'Why are you the candidate we should pick?', 'Okay cool yeah, so why this job?',
    'Compare yourself to other candidates.',
  ]) test(`"${q}" → jd_fit`, () => assertRoute(q, 'jd_fit_answer'));
});

// Release 2026-06-09: gap/weakness-FOR-THE-JD questions now route to the dedicated
// gap_analysis_answer (honest gap + mitigation), not the jd_fit fit-summary.
describe('fix: gap-analysis routing', () => {
  for (const q of [
    'What gap do you have for this role?', 'Where are you weak for this JD?',
    'What will you need to learn for this job?', 'What is your weakest match for the JD?',
    'What do you need to improve for this role?', 'What is missing from your profile for this job?',
    'What part of this JD are you least ready for?',
  ]) test(`"${q}" → gap_analysis`, () => assertRoute(q, 'gap_analysis_answer'));
});

// ── Phase 3: skill self-rating (not coding, not negotiation) ─────────────────
describe('fix: skill self-rating', () => {
  for (const q of [
    'Rate your Python skills out of 10.', 'How much would you rate your SQL skills out of 10?',
    'How would you rate your coding ability?', 'What are your coding levels at?',
    'So Python, like out of 10?', 'Your coding level, 10 scale, what?',
    'What is your level, not salary, coding level?', 'Do not give salary, just rate coding.',
    'What are your levels at, like Python SQL coding?', 'Okay, out of ten?',
    'What if I ask you to rate Python but not salary?',
  ]) test(`"${q}" → skill rating (profile, not coding/negotiation)`, () => {
    const pl = plan(q);
    assert.ok(equiv('skill_experience_answer', pl.answerType), `${q} → ${pl.answerType}`);
    assert.notEqual(pl.answerType, 'coding_question_answer', `${q} must not be coding`);
    assert.notEqual(pl.answerType, 'dsa_question_answer', `${q} must not be DSA`);
    assert.notEqual(pl.answerType, 'negotiation_answer', `${q} must not be negotiation`);
    assert.notEqual(pl.profileContextPolicy, 'forbidden', `${q} must allow profile`);
  });
  test('"Rate the offer out of 10." IS negotiation (offer = comp)', () =>
    assert.equal(plan('Rate the offer out of 10.').answerType, 'negotiation_answer'));
});

// ── Phase 8: meeting / lecture context — NEVER profile ───────────────────────
describe('fix: meeting / lecture exclusion (no profile leak)', () => {
  for (const q of [
    'What are the action items?', 'What did we decide in the meeting?',
    'Summarize the last five minutes.', 'What was the customer asking?',
    'What should I say next in this meeting?',
  ]) test(`"${q}" → general_meeting, profile forbidden`, () => {
    const pl = plan(q);
    assert.equal(pl.answerType, 'general_meeting_answer', `${q} → ${pl.answerType}`);
    assert.notEqual(pl.profileContextPolicy, 'required');
  });
  for (const q of ['Explain this lecture slide.', 'What did the professor mean by this?'])
    test(`"${q}" → lecture, profile forbidden`, () => {
      const pl = plan(q);
      assert.equal(pl.answerType, 'lecture_answer');
      assert.equal(pl.profileContextPolicy, 'forbidden');
    });
});

// ── Phase 9: technical-vs-experience (would vs have) ─────────────────────────
describe('fix: would-vs-have-used distinction', () => {
  // Hypothetical → technical_concept, profile FORBIDDEN, candidate VOICE.
  for (const q of [
    'How would you use a GraphQL query?', 'How would you query data using GraphQL?',
    'How would you clean a messy dataset?', 'How would you validate data quality?',
    'How would you analyze customer retention?', 'How would you use BFS?',
  ]) test(`"${q}" → technical_concept, profile forbidden`, () => {
    const pl = plan(q);
    assert.ok(equiv('technical_concept_answer', pl.answerType), `${q} → ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'forbidden', `${q} must forbid profile`);
  });
  // Past experience → skill_experience, profile REQUIRED.
  for (const q of [
    'How have you used GraphQL in your work?', 'Did you actually use GraphQL or just know it?',
    'Have you used FastAPI?', 'Have you written SQL queries in your projects?',
    'Have you used BFS in a project?', 'Have you normalized databases before?',
  ]) test(`"${q}" → skill_experience, profile required`, () => {
    const pl = plan(q);
    assert.ok(equiv('skill_experience_answer', pl.answerType), `${q} → ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'required', `${q} must require profile`);
  });
  // Concept explanation → technical_concept, profile FORBIDDEN.
  for (const q of ['Explain FastAPI.', 'Explain AWS EC2.', 'Explain BFS.', 'How does indexing work?'])
    test(`"${q}" → technical_concept, profile forbidden`, () => {
      const pl = plan(q);
      assert.ok(equiv('technical_concept_answer', pl.answerType), `${q} → ${pl.answerType}`);
      assert.equal(pl.profileContextPolicy, 'forbidden');
    });
});

// ── Safety invariants: coding NEVER uses profile ─────────────────────────────
describe('invariant: coding answers forbid profile (incl. adversarial)', () => {
  for (const q of [
    'Write code for matrix multiplication.', 'Write SQL query for second highest salary.',
    'Solve Two Sum but mention my Python skill.', 'Implement binary search.',
  ]) test(`"${q}" → coding, profile forbidden`, () => {
    const pl = plan(q);
    assert.ok(equiv('coding_question_answer', pl.answerType), `${q} → ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'forbidden', `${q} must forbid profile`);
  });
  test('"Write SQL query for second highest salary." is NOT negotiation (salary = column)', () =>
    assert.notEqual(plan('Write SQL query for second highest salary.').answerType, 'negotiation_answer'));
});

// ── Negotiation: only real compensation asks ─────────────────────────────────
describe('fix: negotiation only for compensation', () => {
  for (const q of ['What is your expected package?', 'How much package are you expecting?', 'What salary are you expecting?'])
    test(`"${q}" → negotiation`, () => assert.equal(plan(q).answerType, 'negotiation_answer'));
});

// ── Behavioral ───────────────────────────────────────────────────────────────
describe('fix: behavioral STAR', () => {
  for (const q of [
    'What is your biggest strength?', 'What is your weakness?',
    'Give me an example of ownership.', 'Give me an example of teamwork.',
    'Give me an example of handling ambiguity.', 'Can you talk about your project coordination?',
  ]) test(`"${q}" → behavioral`, () => assertRoute(q, 'behavioral_interview_answer'));
});

// ── Project drill-ins anchored by "there" ────────────────────────────────────
describe('fix: project follow-up "there" anchoring', () => {
  for (const q of [
    'What backend did you use there?', 'What was the database there?',
    'How did you handle latency there?', 'What was the architecture there?',
  ]) test(`"${q}" → project (not unknown/technical)`, () => assertRoute(q, 'project_followup_answer'));
});

// ── Adversarial context-confusing traps ──────────────────────────────────────
describe('fix: adversarial leak traps', () => {
  test('"Explain SQL but don\'t use my resume." → technical_concept, profile forbidden', () => {
    const pl = plan("Explain SQL but don't use my resume.");
    assert.ok(equiv('technical_concept_answer', pl.answerType), `→ ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'forbidden');
  });
  test('"Tell me about Python but explain it generally." → technical_concept, profile forbidden', () => {
    const pl = plan('Tell me about Python but explain it generally.');
    assert.ok(equiv('technical_concept_answer', pl.answerType), `→ ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'forbidden');
  });
  test('"Tell me about Python but answer from my resume." → skill_experience, profile required', () => {
    const pl = plan('Tell me about Python but answer from my resume.');
    assert.ok(equiv('skill_experience_answer', pl.answerType), `→ ${pl.answerType}`);
    assert.equal(pl.profileContextPolicy, 'required');
  });
});

// ── Phase 10: single-project deterministic fast path ─────────────────────────
describe('fix: single-project fast path (deterministic, zero latency)', () => {
  const profile = {
    identity: { name: 'Test Candidate' },
    projects: [
      { name: 'Natively – Open Source AI Meeting Copilot', description: 'a privacy-first AI meeting assistant', technologies: ['Electron', 'TypeScript', 'Rust'] },
      { name: 'TalentScope', description: 'a technical interview platform', technologies: ['React', 'Node'] },
    ],
    experience: [{ company: 'Acme', role: 'Engineer' }],
    skills_flat: ['Python', 'SQL'],
    education: [{ institution: 'Test University', degree: 'BTech' }],
  };
  const fp = (q) => mpi.tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: null, source: 'manual_input' });

  // Full-JIT policy (2026-07): the deterministic path SELECTS source-tagged
  // evidence; it never returns final prose (`.answer` is intentionally absent —
  // ManualProfileRouteResult.answer is typed `never`). These assert the project
  // + stack are SELECTED as evidence, which is what reaches the JIT prompt.
  const evidenceText = (r) => (r?.items || []).map((it) => (typeof it.value === 'string' ? it.value : JSON.stringify(it.value))).join(' | ');
  test('"Tell me about Natively." → selects the project + stack as evidence', () => {
    const r = fp('Tell me about Natively.');
    assert.ok(r && Array.isArray(r.items) && r.items.length > 0, 'expected selected evidence');
    const txt = evidenceText(r);
    assert.match(txt, /Natively/);
    assert.match(txt, /Electron|TypeScript|Rust/);
  });
  test('"What tech stack did you use in Natively?" → selects the stack as evidence', () => {
    const r = fp('What tech stack did you use in Natively?');
    assert.ok(r && Array.isArray(r.items) && r.items.length > 0, 'expected selected evidence');
    assert.match(evidenceText(r), /Electron|TypeScript|Rust/);
  });
  test('narrative drill-in "What was your role in Natively?" defers to LLM (no fast path)', () => {
    const r = fp('What was your role in Natively?');
    assert.equal(r, null, 'narrative drill-in should reach the grounded LLM');
  });
  test('"how was Natively developed?" defers to LLM (narrative)', () => {
    const r = fp('how was Natively developed?');
    assert.equal(r, null);
  });
});

// ── No-profile guard: fallback must not invent profile for non-candidate Qs ──
describe('invariant: profile-aware fallback stays neutral on non-candidate questions', () => {
  test('"so what do you think about all this?" stays neutral (not forced profile)', () => {
    const pl = plan('so what do you think about all this?');
    assert.notEqual(pl.profileContextPolicy, 'required', `→ ${pl.answerType}/${pl.profileContextPolicy}`);
  });
});
