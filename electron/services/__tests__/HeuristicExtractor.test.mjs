// electron/services/__tests__/HeuristicExtractor.test.mjs
//
// D2 fix (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R2): the LLM-free
// fallback resume/JD parser. Its ONLY job is to populate the MINIMUM structured
// shape needed for profileFactsReady + the deterministic fast path when the
// extraction LLM is unavailable (billing-blocked / timed out). It must:
//   - extract a usable name, skills, experience, projects, education,
//   - never fabricate (empty sections stay empty),
//   - produce a shape that satisfies the same profileFactsReady predicate the
//     production path uses,
//   - be pure (no LLM, no I/O).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadCompiled = (rel) =>
  import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/' + rel)).href);

const { heuristicResumeExtract, heuristicJDExtract } = await loadCompiled('HeuristicExtractor.js');
// Reuse the production readiness predicate so the test proves real readiness.
const { profileFactsReady } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);

const RESUME = `Evin John
Founder & Full-Stack Engineer
evin.john@example.com | +1 555 0100 | github.com/evinjohn | linkedin.com/in/evinjohn

SUMMARY
Final-year B.Tech CSE student and founder building AI copilots.

SKILLS
Languages: TypeScript, Python, Go, SQL
Frameworks: React, Next.js, FastAPI, Node.js
Cloud: AWS, GCP, Vercel
Databases: PostgreSQL, Redis, pgvector
AI/ML: PyTorch, LangChain, RAG
Tools: Git, Docker, Figma

EXPERIENCE
Founder at Natively (2024-01 - Present)
- Built a real-time meeting copilot used by thousands.
- Designed the multi-provider STT and LLM fallback chain.
Software Engineer Intern at Aetherbot AI (2023-05 - 2023-08)
- Shipped a vector-search retrieval pipeline.

PROJECTS
ABTest-Framework: A/B testing library with stats engine. React, Node.js
SQL-Copilot: Natural-language to SQL with pgvector retrieval. Python, FastAPI

EDUCATION
B.Tech in Computer Science, Cochin University (2021-08 - 2025-05)
`;

describe('heuristicResumeExtract', () => {
  const r = heuristicResumeExtract(RESUME);

  test('extracts the candidate name from the first line', () => {
    assert.equal(r.identity.name, 'Evin John');
  });

  test('extracts contact fields by regex', () => {
    assert.equal(r.identity.email, 'evin.john@example.com');
    assert.match(r.identity.github || '', /evinjohn/);
    assert.match(r.identity.linkedin || '', /evinjohn/);
  });

  test('categorizes skills into the v2 buckets', () => {
    assert.ok(r.skills.languages.includes('TypeScript'));
    assert.ok(r.skills.languages.includes('Python'));
    assert.ok(r.skills.frameworks.includes('React'));
    assert.ok(r.skills.cloud.includes('AWS'));
    assert.ok(r.skills.databases.includes('PostgreSQL'));
    assert.ok(r.skills.ml.includes('PyTorch'));
  });

  test('extracts experience entries with role and company', () => {
    assert.ok(r.experience.length >= 1);
    const founder = r.experience.find((e) => /natively/i.test(e.company) || /founder/i.test(e.role));
    assert.ok(founder, 'should find the Natively / Founder entry');
  });

  test('extracts project names', () => {
    const names = r.projects.map((p) => p.name);
    assert.ok(names.some((n) => /ABTest-Framework/i.test(n)), `projects: ${names.join(', ')}`);
    assert.ok(names.some((n) => /SQL-Copilot/i.test(n)), `projects: ${names.join(', ')}`);
  });

  test('extracts an education entry', () => {
    assert.ok(r.education.length >= 1);
    assert.match(JSON.stringify(r.education[0]), /Cochin|Computer Science|B\.?Tech/i);
  });

  test('the result satisfies the production profileFactsReady predicate', () => {
    assert.equal(profileFactsReady(r), true);
  });

  test('stamps the extraction mode as heuristic', () => {
    assert.equal(r._extraction_mode, 'heuristic');
  });

  test('never fabricates: empty resume yields empty (not-ready) shape', () => {
    const empty = heuristicResumeExtract('');
    assert.equal(profileFactsReady(empty), false);
    assert.deepEqual(empty.experience, []);
    assert.deepEqual(empty.projects, []);
  });

  test('a name-only resume is still ready (name alone is usable)', () => {
    const r2 = heuristicResumeExtract('Jane Q. Public\nSoftware Engineer\n');
    assert.equal(r2.identity.name, 'Jane Q. Public');
    assert.equal(profileFactsReady(r2), true);
  });

  test('does not mistake a capitalized bare-domain header line for the name (code review finding)', () => {
    // "LinkedIn.com/in/janedoe" / "GitHub.com/johnsmith" (no https://, capitalized
    // brand rendering) previously passed every looksLikeName check and got
    // captured as the candidate's NAME, permanently shadowing the real name below.
    const r1 = heuristicResumeExtract('LinkedIn.com/in/janedoe\nJane Doe\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r1.identity.name, 'Jane Doe');
    const r2 = heuristicResumeExtract('GitHub.com/johnsmith\nJohn Smith\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r2.identity.name, 'John Smith');
  });

  test('does not mistake an ALL-CAPS section header for a name', () => {
    const r3 = heuristicResumeExtract('RESUME\nSKILLS\nPython');
    assert.notEqual(r3.identity.name, 'RESUME');
    assert.notEqual(r3.identity.name, 'SKILLS');
  });

  test('produces complete CategorizedSkills shape (all 7 keys present)', () => {
    for (const k of ['languages', 'frameworks', 'cloud', 'databases', 'ml', 'devops', 'tools']) {
      assert.ok(Array.isArray(r.skills[k]), `missing skills bucket ${k}`);
    }
  });
});

const JD = `Senior Data Analyst
Acme Analytics — Remote (US)

About the role
We are hiring a Senior Data Analyst to own our experimentation platform.

Requirements
- 5+ years SQL and Python
- Experience with A/B testing and statistics
- Strong data visualization skills

Nice to have
- dbt, Snowflake

Responsibilities
- Build dashboards and self-serve analytics
- Partner with product on experiment design
`;

describe('heuristicJDExtract', () => {
  const jd = heuristicJDExtract(JD);

  test('extracts a title', () => {
    assert.match(jd.title, /Data Analyst/i);
  });

  test('extracts requirements as a non-empty list', () => {
    assert.ok(jd.requirements.length >= 1, `requirements: ${JSON.stringify(jd.requirements)}`);
  });

  test('valid enum defaults so downstream never crashes', () => {
    assert.ok(['intern', 'entry', 'mid', 'senior', 'staff', 'principal'].includes(jd.level));
    assert.ok(['full_time', 'part_time', 'contract', 'internship'].includes(jd.employment_type));
  });

  test('empty JD still returns a valid shape (no throw, fallback title)', () => {
    const j2 = heuristicJDExtract('');
    assert.equal(typeof j2.title, 'string');
    assert.ok(Array.isArray(j2.requirements));
  });
});

// E2E MiniMax campaign (autopilot pass): multi-line education blocks were parsed
// one-entry-per-LINE, so "University of Washington, Seattle" became
// degree="University of Washington" and "B.S. in CS, with honors" became
// institution="with". The parser now GROUPS the institution/degree/GPA/thesis
// lines of one entry together.
describe('heuristicResumeExtract — multi-line education grouping', () => {
  test('groups institution + degree + GPA + thesis lines into ONE clean entry', () => {
    const resume = `Marissa Chen\n\nEDUCATION\nUniversity of Washington, Seattle\nB.S. in Computer Science, with honors                              2011 - 2015\nGPA: 3.78/4.0\nSenior thesis: "Adaptive Sampling Strategies for High-Volume Time-Series Data"\n`;
    const r = heuristicResumeExtract(resume);
    assert.equal(r.education.length, 1, 'exactly one education entry (not 4)');
    const e = r.education[0];
    assert.match(e.institution, /University of Washington/, 'institution correct');
    assert.match(e.degree, /B\.?\s?S/i, 'degree is the B.S., not the university name');
    assert.match(e.field, /Computer Science/i, 'field captured');
    assert.doesNotMatch(e.institution, /^with$/i, 'institution is NOT "with" (the old bug)');
    assert.doesNotMatch(e.degree, /University|GPA|thesis/i, 'degree is NOT the institution/GPA/thesis');
    if (e.gpa) assert.match(e.gpa, /3\.78/, 'GPA captured into the gpa field when present');
  });

  test('separates two distinct degrees (BSN + ADN) into two entries', () => {
    const resume = `Maria Gutierrez\n\nEDUCATION\nUniversity of Cincinnati\nBachelor of Science in Nursing (BSN)                    2016 - 2019\nCincinnati State Technical and Community College\nAssociate of Science in Nursing (ADN)                   2013 - 2015\n`;
    const r = heuristicResumeExtract(resume);
    assert.equal(r.education.length, 2, 'two education entries');
    assert.ok(r.education.some((e) => /BSN|Bachelor/i.test(e.degree)), 'BSN present');
    assert.ok(r.education.some((e) => /ADN|Associate/i.test(e.degree)), 'ADN present');
  });

  test('does not fabricate education when the section is absent', () => {
    const r = heuristicResumeExtract('Jane Doe\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r.education.length, 0, 'no education invented');
  });
});

// E2E MiniMax campaign (autopilot pass): name + non-tech-experience parsing bugs
// found by a deterministic 10-profile extraction sweep.
describe('heuristicResumeExtract — name + non-tech section robustness', () => {
  test('section header is NOT captured as the name ("PROFESSIONAL SUMMARY")', () => {
    const r = heuristicResumeExtract('PROFESSIONAL SUMMARY\nSeasoned engineer with 10 years...\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.doesNotMatch(r.identity.name, /professional|summary/i, 'header must not be the name');
  });
  test('a quoted nickname line is accepted as the name (MARGARET "MEG" DONOVAN)', () => {
    const r = heuristicResumeExtract('MARGARET "MEG" DONOVAN\nAtlanta, GA | meg.donovan.email@gmail.com\n\nEXPERIENCE\nAnalyst at DataCo (2019 - 2023)\n');
    assert.match(r.identity.name, /margaret|meg|donovan/i, 'quoted-nickname name is kept');
    assert.doesNotMatch(r.identity.name, /\bemail\b/i, 'the "email" label must not leak into the name');
  });
  test('nameFromEmail drops label tokens ("meg.donovan.email@" → not "... Email")', () => {
    // No name line at all → falls back to email; must still be clean.
    const r = heuristicResumeExtract('meg.donovan.email@gmail.com\n\nEXPERIENCE\nAnalyst at DataCo (2019 - 2023)\n');
    assert.doesNotMatch(r.identity.name, /\bemail\b/i);
  });
  test('non-tech "CLINICAL EXPERIENCE" header is parsed as experience', () => {
    const r = heuristicResumeExtract('Maria Gutierrez\n\nCLINICAL EXPERIENCE\nUniversity of Cincinnati Medical Center — Cincinnati, OH\nCritical Care RN                              2016 - 2023\n- Managed high-acuity patients.\n');
    assert.ok(r.experience.length >= 1, 'clinical experience must be parsed (was 0)');
  });
});

// E2E autopilot pass — education edge cases from the 10-profile sweep.
describe('heuristicResumeExtract — education institution edge cases', () => {
  test('a graduation date after the degree is NOT the institution; the next line is', () => {
    const r = heuristicResumeExtract('Meg Donovan\n\nEDUCATION\nBachelor of Science in Mathematics Education, May 2017\nUniversity of Georgia, Athens, GA\n');
    assert.equal(r.education.length, 1);
    assert.match(r.education[0].institution, /University of Georgia/, 'institution is the school, not "May 2017"');
    assert.doesNotMatch(r.education[0].institution, /may|2017/i);
  });
  test('an institution line with a state code ("…, MA") is not misread as an M.A. degree', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nEDUCATION\nMaster of Science in Computer Science\nMassachusetts Institute of Technology — Cambridge, MA\nSeptember 2004 – June 2006\n');
    assert.equal(r.education.length, 1, 'one entry, not two (MIT must attach, not become a degree)');
    assert.match(r.education[0].degree, /Master/i);
    assert.match(r.education[0].institution, /Massachusetts Institute of Technology/i);
  });
});

// E2E autopilot pass — credential-suffix name parsing.
describe('heuristicResumeExtract — professional credential suffix in name line', () => {
  test('strips post-nominal credentials from the name ("MARIA GUTIERREZ, RN, BSN, CCRN")', () => {
    const r = heuristicResumeExtract('MARIA ELENA GUTIERREZ, RN, BSN, CCRN\n2847 Westwood Ave | Cincinnati, OH | maria.gutierrez.rn@gmail.com\n\nEDUCATION\nBachelor of Science in Nursing\nUniversity of Cincinnati\n');
    assert.equal(r.identity.name, 'MARIA ELENA GUTIERREZ');
    assert.doesNotMatch(r.identity.name, /\bRN\b|\bBSN\b|\bCCRN\b/);
  });
  test('does not strip a real middle/last name that happens to be short', () => {
    const r = heuristicResumeExtract('JOHN SMITH, MBA, PMP\n123 Main St | john.smith@gmail.com\n\nEDUCATION\nMBA\nHarvard Business School\n');
    assert.equal(r.identity.name, 'JOHN SMITH');
  });
});

// E2E autopilot pass — skills-section parsing robustness (10-profile sweep).
describe('heuristicResumeExtract — skills section robustness', () => {
  test('a qualified header ("CORE SKILLS") is recognized, not just bare "SKILLS"', () => {
    const r = heuristicResumeExtract('Jamie Lee\n\nCORE SKILLS\nPython, Go, SQL\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.ok(r.skills_flat.length >= 3, 'skills parsed from a qualified header');
    assert.ok(r.skills_flat.includes('Python'));
  });
  test('bullet-and-category-label rows parse cleanly ("Languages  ▪ Python  ▪ Go")', () => {
    const r = heuristicResumeExtract('Jamie Lee\n\nSKILLS\nLanguages        ▪ Python   ▪ Go   ▪ TypeScript\nInfrastructure   ▪ Kubernetes · Terraform · AWS\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.ok(r.skills_flat.includes('Python'));
    assert.ok(r.skills_flat.includes('Kubernetes'));
    assert.ok(!r.skills_flat.some((s) => s.includes('▪')), 'no stray bullet characters');
    assert.ok(!r.skills_flat.includes('Languages'), 'category label is not itself a skill');
  });
  test('a parenthetical skill group keeps its internal comma ("SQL (PostgreSQL, MySQL)")', () => {
    const r = heuristicResumeExtract('Jamie Lee\n\nSKILLS\nSQL (PostgreSQL, MySQL), Python, Git/GitHub\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.ok(r.skills_flat.some((s) => s.includes('PostgreSQL') && s.includes('MySQL')), 'kept together as one skill entry');
  });
  test('a verbose parenthetical skill still yields its lead token ("Excel (pivot tables, VLOOKUP…)")', () => {
    const r = heuristicResumeExtract('Jamie Lee\n\nSKILLS\nExcel (pivot tables, VLOOKUP/XLOOKUP, charts, Power Query basics), Python\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.ok(r.skills_flat.includes('Excel'), 'lead token kept even when the full entry is too long/wordy');
    assert.ok(r.skills_flat.includes('Python'));
  });
});

// E2E MiniMax campaign (autopilot pass) — real-world JD format defects found by
// a deterministic 10-profile sweep: company/title swapped or blank, markdown
// asterisks leaking into fields, "What You Bring" not recognized as a
// requirements header, and technologies hardcoded to always be empty.
describe('heuristicJDExtract — real-world format robustness', () => {
  test('explicit "**Company:**" label (markdown-wrapped) is read cleanly', () => {
    const jd = heuristicJDExtract('**Senior Product Designer (Contract-to-Hire)**\n\n**Company:** Lumen & Forge, Inc.\n**Location:** Remote\n\n**Requirements**\n- 5+ years of product design experience\n');
    assert.equal(jd.company, 'Lumen & Forge, Inc.');
    assert.doesNotMatch(jd.title, /\*/, 'no stray markdown asterisks in the title');
  });

  test('"Company\\nTitle" order (no label) is disambiguated via role-noun heuristic', () => {
    const jd = heuristicJDExtract('Mercy Ridge Health Network\nClinical Care Coordinator — Inpatient Medicine\nFull-Time | Lakeview, OH\n\nRequirements\n- RN license\n');
    assert.equal(jd.company, 'Mercy Ridge Health Network');
    assert.match(jd.title, /Clinical Care Coordinator/);
  });

  test('"Company — Title" on one line splits on em-dash, not internal hyphens', () => {
    const jd = heuristicJDExtract('Coastal Logistics Inc. — Full-Stack Engineer\n\nLocation: Boston, MA\n\nRequirements\n- 3+ years experience\n');
    assert.equal(jd.company, 'Coastal Logistics Inc.');
    assert.equal(jd.title, 'Full-Stack Engineer', 'must not split on the hyphen inside "Full-Stack"');
  });

  test('"Job Description: X" / "Job Title: X" prefix is stripped from the title', () => {
    const jd = heuristicJDExtract('Job Description: Junior Software Developer\n\nCompany: NorthBay Logistics Technologies\n\nRequirements\n- CS degree\n');
    assert.equal(jd.title, 'Junior Software Developer');
  });

  test('"What You Bring" is recognized as a requirements header (not just "Requirements")', () => {
    const jd = heuristicJDExtract('Director of Engineering\nLocation: Austin, TX\n\nWhat You Bring\n- 12+ years of engineering experience\n- A track record of scaling engineering orgs\n');
    assert.ok(jd.requirements.length >= 2, 'requirements collected under "What You Bring"');
  });

  test('technologies are extracted from the JD text (was hardcoded to [])', () => {
    const jd = heuristicJDExtract('Senior Engineer\nCompany: Acme\n\nRequirements\n- Strong experience with Python, Kubernetes, and PostgreSQL\n- AWS and Terraform experience a plus\n');
    assert.ok(jd.technologies.includes('Python'));
    assert.ok(jd.technologies.includes('Kubernetes'));
    assert.ok(jd.technologies.includes('PostgreSQL'));
  });

  test('keywords are populated from technologies + title (was hardcoded to [])', () => {
    const jd = heuristicJDExtract('Senior Platform Engineer\nCompany: Acme\n\nRequirements\n- Go, Kubernetes, Terraform experience\n');
    assert.ok(jd.keywords.length > 0, 'keywords must not be empty');
    assert.ok(jd.keywords.includes('Go') || jd.keywords.includes('Kubernetes'));
  });
});

// E2E MiniMax campaign (autopilot pass) — experience section MULTI-LINE grouping.
// The old parser treated every non-bullet line as a NEW entry, so a standard
// "Company\nTitle\nDates\n- bullets" job (or any line-order variant) broke into
// 2-3 garbage entries. Affected 20-100% of experience entries on EVERY profile.
describe('heuristicResumeExtract — experience multi-line grouping', () => {
  test('"Company — Title" then "Dates" then bullets groups into ONE entry', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nStripe, Inc. — Staff Software Engineer (L6)\nSan Francisco, CA | March 2022 – Present\n- Led the payments reconciliation rewrite.\n- Reduced latency by 60%.\n\nEDUCATION\nB.S. Computer Science\nStanford University\n');
    assert.equal(r.experience.length, 1);
    assert.match(r.experience[0].company, /Stripe/);
    assert.match(r.experience[0].role, /Staff Software Engineer/);
    assert.equal(r.experience[0].start_date, '2022-03');
    assert.equal(r.experience[0].bullets.length, 2);
  });

  test('"Title" then "Company — Location" then "Dates" (reverse order) groups correctly', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nVP of Platform Engineering\nStratagem Cloud, Inc. — San Francisco, CA\nMarch 2021 – Present\n- Own the platform org.\n\nEDUCATION\nB.S. Computer Science\nStanford University\n');
    assert.equal(r.experience.length, 1);
    assert.match(r.experience[0].role, /VP of Platform Engineering/);
    assert.match(r.experience[0].company, /Stratagem Cloud/);
  });

  test('"Company (no role noun) — City, ST" is NOT split into role/company halves', () => {
    // A company+location line with neither side matching a role noun must stay
    // ONE company string (the old bug put the city in the "company" field and
    // the hospital name in "role").
    const r = heuristicResumeExtract('Pat Lee\n\nCLINICAL EXPERIENCE\nUniversity of Cincinnati Medical Center — Cincinnati, OH\nCritical Care Registered Nurse\nJune 2020 – Present\n- Managed post-op patients.\n\nEDUCATION\nBSN\nUniversity of Cincinnati\n');
    assert.equal(r.experience.length, 1);
    assert.match(r.experience[0].company, /University of Cincinnati Medical Center/);
    assert.match(r.experience[0].role, /Critical Care Registered Nurse/);
  });

  test('two jobs in sequence produce two SEPARATE entries, not one merged blob', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nAcme Corp — Senior Engineer\nJanuary 2020 – December 2022\n- Built the core API.\n\nBeta Inc — Software Engineer\nJanuary 2018 – December 2019\n- Maintained the legacy system.\n\nEDUCATION\nB.S.\nMIT\n');
    assert.equal(r.experience.length, 2);
    assert.match(r.experience[0].company, /Acme/);
    assert.match(r.experience[1].company, /Beta/);
  });

  test('divider/rule lines ("────") are never captured as a garbage entry', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\n────────────────────\nAcme Corp — Senior Engineer\nJanuary 2020 – Present\n- Built things.\n\nEDUCATION\nB.S.\nMIT\n');
    assert.equal(r.experience.length, 1, 'the divider must not become its own entry');
    assert.match(r.experience[0].company, /Acme/);
  });

  test('MM/YYYY date format ("03/2022 – Present") is parsed', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nHelix Freight Labs\nSenior Software Engineer                       03/2022 – Present\n- Led dispatch optimization.\n\nEDUCATION\nB.S.\nMIT\n');
    assert.equal(r.experience[0].start_date, '2022-03');
  });

  test('executive titles (VP, CTO, Head of) are recognized as roles', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nVP of Engineering\nAcme Corp\nJanuary 2020 – Present\n- Led the org.\n\nEDUCATION\nB.S.\nMIT\n');
    assert.match(r.experience[0].role, /VP of Engineering/);
    assert.match(r.experience[0].company, /Acme/);
  });

  test('a trailing "City, ST" location line does not spawn its own blank entry', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nWORK EXPERIENCE\nSoftware Engineer II                                     August 2015 - July 2017\nNimbus Systems\nSeattle, WA\n- Built the original search feature.\n- Reduced infra costs.\n\nEDUCATION\nB.S.\nMIT\n');
    assert.equal(r.experience.length, 1, 'the location line must not become its own entry');
    assert.match(r.experience[0].company, /Nimbus Systems/);
    assert.equal(r.experience[0].bullets.length, 2, 'bullets attach to the real entry, not a location-line ghost entry');
  });
});

// E2E MiniMax campaign (autopilot pass) — projects section parsing. A bare
// GitHub/URL metadata line, or a name with a date range in parens, was
// mis-parsed into a separate garbage entry or a truncated project name.
describe('heuristicResumeExtract — projects section robustness', () => {
  test('a bare "github.com/user/repo | dates" line attaches its URL to the PREVIOUS project, not a new entry', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nPROJECTS\nBookSwap: A peer to peer book exchange platform.\ngithub.com/jmitchell-dev/bookswap | January 2025 - April 2025\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r.projects.length, 1, 'the URL line must not become its own project');
    assert.equal(r.projects[0].name, 'BookSwap');
    assert.match(r.projects[0].url, /bookswap/);
  });

  test('a name with a date range in parens keeps the FULL name, splitting at the outer colon', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nPROJECTS\n- KubeFortress (2023 – Present): Open-source Kubernetes policy engine with 11,400 GitHub stars.\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r.projects[0].name, 'KubeFortress (2023 – Present)', 'must not truncate at the en-dash inside the parens');
  });

  test('a divider/rule line in the projects section is never captured as a project', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nPROJECTS\n────────────────────\npq-tap: A PostgreSQL connection pool testing harness.\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r.projects.length, 1, 'the divider must not become its own entry');
    assert.match(r.projects[0].name, /pq-tap/);
  
  test('a column-formatted title strips the multi-space metadata tail ("Name    Open source · dates")', () => {
    const r = heuristicResumeExtract('Pat Lee\n\nPROJECTS\npq-tap                                        Open source \u00b7 2021 \u2013 Present\nA plug-and-back-pressure testing harness for PostgreSQL connection pools.\n\nEXPERIENCE\nEngineer at Acme (2020 - 2023)\n');
    assert.equal(r.projects[0].name, 'pq-tap', 'name must not include the tag/date metadata tail');
  });
});
});
