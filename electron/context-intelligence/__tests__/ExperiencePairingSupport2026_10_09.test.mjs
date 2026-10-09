// electron/context-intelligence/__tests__/ExperiencePairingSupport2026_10_09.test.mjs
//
// Experience pairings (2026-10-09). A derived experience entry can be made of
// the résumé's own words and still say what the résumé does not: a job title
// paired with the wrong employer, an employer that is a description line, a
// page marker or a wrapped bullet. Such entries went into the prompt as RESUME
// evidence beside the résumé itself and the answers repeated them.
// Rule under test (profile-derived-support.ts): an entry is rejected on
// evidence only (its shape, or where title and company stand in the résumé
// text); when any entry of a résumé is rejected the V3 profile port renders
// none of that résumé's derived experience statements.
//
// Run: npm run build:electron && node --test electron/context-intelligence/__tests__/ExperiencePairingSupport2026_10_09.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const {
  experiencePairingProblem, resumeTextLines, unsupportedExperienceEntries, stripUnsupportedDerivedResumeFields,
} = await import(pathToFileURL(path.join(base, 'retrieval/profile-derived-support.js')).href);
const { createProfileRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { resolveModePolicy } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

// Two job titles at the first employer, one at the second, each employer followed by a line that describes it.
const RESUME = `Mira Okafor
Staff Data Engineer

Experience

Brindlewick Analytics, Leeds
Demand forecasting for grocery chains.

Staff Data Engineer | March 2024 - Present
\t•\tLead the ingestion platform team of 6.
\t•\tCut the nightly batch from 5 hours to 50 minutes.

Senior Data Engineer | May 2021 - February 2024
\t•\tMoved 300 Airflow jobs to incremental models over 7 months.
\t•\tIntroduced data contracts between 4 producer teams.

Harrowgate Logistics, York
Parcel routing for regional couriers.

Data Engineer | August 2018 - April 2021
\t•\tBuilt the route-cost feature store used by 3 pricing models.
`;

const RIGHT = [
  { role: 'Staff Data Engineer', company: 'Brindlewick Analytics, Leeds', start_date: '2024-03', end_date: null, bullets: ['Lead the ingestion platform team of 6.'] },
  { role: 'Senior Data Engineer', company: 'Brindlewick Analytics, Leeds', start_date: '2021-05', end_date: '2024-02', bullets: ['Moved 300 Airflow jobs to incremental models over 7 months.'] },
  { role: 'Data Engineer', company: 'Harrowgate Logistics, York', start_date: '2018-08', end_date: '2021-04', bullets: ['Built the route-cost feature store used by 3 pricing models.'] },
];
// What a line-by-line reader makes of the same page: the second title takes the NEXT employer, the third takes the
// description line under it.
const MISPAIRED = [
  RIGHT[0],
  { ...RIGHT[1], company: 'Harrowgate Logistics, York' },
  { ...RIGHT[2], company: 'Parcel routing for regional couriers.' },
];

describe('experiencePairingProblem: shape', () => {
  const no = (e) => experiencePairingProblem(e, [], null);
  test('a page marker is not an employer', () => {
    for (const company of ['[Page 2]', '-- 2 of 3 --', 'Page 4 of 9']) assert.equal(no({ role: 'Software Engineer', company }), 'company_is_page_marker', company);
  });
  test('a company that ends a sentence is a line of text, not a name', () => {
    assert.equal(no({ role: 'Software Engineer II', company: 'ships.' }), 'company_ends_a_sentence');
    assert.equal(no({ role: 'Data Engineer', company: 'Parcel routing for regional couriers.' }), 'company_ends_a_sentence');
  });
  test('corporate abbreviations end in a period and are names', () => {
    for (const company of ['Acme Inc.', 'Harrowgate Logistics Ltd.', 'Kessel & Co.', 'Brindlewick S.A.', 'Vantor GmbH.']) assert.equal(no({ role: 'Engineer', company }), null, company);
  });
  test('a wrapped bullet read as a job is too long to be a title or a company', () => {
    assert.equal(no({ role: 'Tech lead for the platform, a team of five: I lead four engineers, own the roadmap, run the', company: 'weekly design review and sign off the production-readiness checklist for every service the team' }), 'company_too_long');
    assert.equal(no({ role: 'Built and operated the fare-quote service, in Kotlin on Ktor with PostgreSQL and a Redis cache', company: '' }), 'title_too_long');
  });
  test('ordinary names pass, lowercase and one-word ones included', () => {
    for (const company of ['adidas', 'eBay', 'Brindlewick Analytics, Leeds', 'Lumen (remote-first)', '株式会社メルカリ', 'Yahoo!']) assert.equal(no({ role: 'Engineer', company }), null, company);
  });
});

describe('experiencePairingProblem: where title and company stand in the résumé', () => {
  const lines = resumeTextLines(RESUME);
  const problems = (entries) => entries.map((e) => experiencePairingProblem(e, entries.filter((o) => o !== e), lines));

  test('the résumé\'s own pairings are supported, the second title at one employer included', () => {
    assert.deepEqual(problems(RIGHT), [null, null, null]);
  });
  test('a title paired with the employer named BELOW its bullets is rejected', () => {
    assert.equal(experiencePairingProblem(MISPAIRED[1], [MISPAIRED[0]], lines), 'pairing_not_in_the_text');
  });
  test('a title paired with an employer two blocks above is rejected (another employer stands between)', () => {
    const wrong = { role: 'Data Engineer', company: 'Brindlewick Analytics, Leeds' };
    assert.equal(experiencePairingProblem(wrong, [{ role: 'x', company: 'Harrowgate Logistics, York' }], lines), 'pairing_not_in_the_text');
  });
  test('"Title, then Company | dates" on the next line is supported', () => {
    const raw = 'Experience\nPlatform Engineer\nNorthfold Systems | 2020 - 2023\n- Ran the deploy pipeline.\nSupport Engineer\nQuillmere Ltd. | 2017 - 2020\n- Handled escalations.\n';
    const entries = [{ role: 'Platform Engineer', company: 'Northfold Systems' }, { role: 'Support Engineer', company: 'Quillmere Ltd.' }];
    assert.deepEqual(unsupportedExperienceEntries({ experience: entries }, raw), []);
  });
  test('one line per job ("Title, Company (dates)") is supported', () => {
    const raw = 'EXPERIENCE\nBackend Engineer, Finlytics (2022 – Present)\n- Built a ledger service.\nJunior Developer, Tallowmere (2019 – 2022)\n- Wrote billing reports.\n';
    const entries = [{ role: 'Backend Engineer', company: 'Finlytics' }, { role: 'Junior Developer', company: 'Tallowmere' }];
    assert.deepEqual(unsupportedExperienceEntries({ experience: entries }, raw), []);
  });
  test('a title or company the extractor normalised cannot be checked, so the entry is kept', () => {
    const entries = [{ role: 'Sr. Data Engineer', company: 'Brindlewick Analytics, Leeds' }, { role: 'Data Engineer', company: 'Harrowgate Logistics Limited' }];
    assert.deepEqual(unsupportedExperienceEntries({ experience: entries }, RESUME), []);
  });
  test('a page marker in the text is not a line', () => {
    const raw = 'Experience\nOrrin Freight, Pune\nSenior Engineer | 2022 - Present\n- Owns the tracking pipeline.\n[Page 2]\n- Leads four engineers.\n';
    assert.ok(!resumeTextLines(raw).includes('[page 2]'));
    assert.deepEqual(unsupportedExperienceEntries({ experience: [{ role: 'Senior Engineer', company: 'Orrin Freight, Pune' }] }, raw), []);
  });
});

describe('unsupportedExperienceEntries', () => {
  test('names the wrong entries and why', () => {
    assert.deepEqual(unsupportedExperienceEntries({ experience: MISPAIRED }, RESUME), [
      { index: 1, problem: 'pairing_not_in_the_text' }, { index: 2, problem: 'company_ends_a_sentence' },
    ]);
  });
  test('nothing is checked without résumé text, an experience list, or an object', () => {
    assert.deepEqual(unsupportedExperienceEntries({ experience: MISPAIRED }, null), []);
    assert.deepEqual(unsupportedExperienceEntries({ experience: MISPAIRED }, '   '), []);
    assert.deepEqual(unsupportedExperienceEntries({ experience: 'x' }, RESUME), []);
    assert.deepEqual(unsupportedExperienceEntries(null, RESUME), []);
    assert.deepEqual(unsupportedExperienceEntries({ experience: [null, 7, {}] }, RESUME), []);
  });
  test('the other profile routes are untouched: the shared strip function still returns every entry', () => {
    assert.deepEqual(stripUnsupportedDerivedResumeFields({ experience: MISPAIRED }, RESUME).experience, MISPAIRED);
  });
});

// ── V3 profile port ─────────────────────────────────────────────────────────
const LFW = resolveModePolicy('looking-for-work');
const decision = (q) => decide({ requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work', scope: { userId: 'local' }, sessionId: 'eps-s1', manualQuestion: q });
const card = (e, i) => ({ id: `x${i}`, type: 'candidate_experience', title: `${e.role} at ${e.company}`, generatedFrom: 'structured_profile',
  body: `${e.role} at ${e.company} (${e.start_date} to ${e.end_date ?? 'Present'}).\nKey contributions from the resume:\n- ${e.bullets[0]}` });
const doc = (experience) => ({
  kind: 'resume', sourceId: 'psrc_resume_eps', versionId: 'rv1', fileName: 'Candidate Resume (Profile Intelligence)', rawText: RESUME,
  structured: { identity: { name: 'Mira Okafor', summary: '' }, experience, skills: { languages: ['Python', 'SQL'] } },
  cards: [...experience.map(card), { id: 's1', type: 'candidate_summary', title: 'Professional Summary', body: 'Staff Data Engineer.', generatedFrom: 'structured_profile' }],
});
const QUESTIONS = ['where did I move the Airflow jobs to incremental models', 'how long have I worked at Brindlewick', 'list every employer on my résumé',
  'what did I do at Harrowgate Logistics', 'tell me about my experience'];
const evidenceFor = async (experience) => {
  const port = createProfileRetrievalPort({ docs: [doc(experience)], allowedSourceTypes: LFW.allowedSourceTypes, profileSources: LFW.profileSources, userId: 'local' });
  const out = [];
  for (const q of QUESTIONS) out.push(...(await port.retrieve({ decision: decision(q) })).evidence);
  return out;
};
const derivedExperience = (e) => /^Experience: /.test(e.section ?? '') || e.section === 'Complete employment history' || /Key contributions from the resume:/.test(e.content);

describe('V3 profile port: derived experience statements', () => {
  test('a résumé whose entries its text supports is served as before', async () => {
    const ev = await evidenceFor(RIGHT);
    assert.ok(ev.some((e) => e.section === 'Complete employment history'), 'the complete-history line is evidence');
    assert.ok(ev.some((e) => /^Experience: Senior Data Engineer at Brindlewick Analytics, Leeds/.test(e.section ?? '')), 'the per-entry section is evidence');
  });
  test('one wrong pairing: no derived experience statement of that résumé is evidence', async () => {
    const ev = await evidenceFor(MISPAIRED);
    assert.deepEqual(ev.filter(derivedExperience).map((e) => e.section), []);
    assert.ok(!ev.some((e) => /Senior Data Engineer at Harrowgate/.test(e.content)), 'the wrong pairing is nowhere');
    assert.ok(!ev.some((e) => /No other employment is listed/.test(e.content)));
  });
  test('the résumé text itself still says who worked where, and the other sections stay', async () => {
    const ev = await evidenceFor(MISPAIRED);
    assert.ok(ev.some((e) => /Senior Data Engineer \| May 2021/.test(e.content) && /Brindlewick Analytics, Leeds/.test(e.content)), 'title and employer reachable from the résumé text');
    assert.ok(ev.some((e) => /Moved 300 Airflow jobs/.test(e.content)));
    assert.ok(ev.some((e) => /Python/.test(e.content)), 'skills inventory unaffected');
  });
});
