// electron/llm/__tests__/ResidualFixes2026_06_07.test.mjs
//
// Release 2026-06-07 — the 4 residual failure patterns from the 1000-q flash-lite
// run, plus the hardened coding-leak validator.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, validateProfileOutput, stripProfileTokensFromCoding } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);
const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
const CODING_PLAN = { answerType: 'dsa_question_answer', outputPerspective: 'assistant_explanation', forbiddenContextLayers: ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'] };
const TOKENS = { firstName: 'Evin', projects: ['Natively', 'TalentScope'], companies: ['EstroTech'] };

describe('Pattern 1: "what is Natively built with" → product-about', () => {
  for (const q of [
    'what is natively built with', 'what tech stack is Natively built with',
    'what is Natively made using', 'what are the technologies behind Natively',
    'what is the architecture of Natively',
  ]) {
    test(`"${q}" → project_about/project alias, profile required, no JD/nego`, () => {
      const p = plan(q);
      assert.ok(['project_about_answer', 'project_answer', 'project_followup_answer'].includes(p.answerType), `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'required');
      assert.ok(p.forbiddenContextLayers.includes('negotiation'));
    });
  }
  test('"how did you build Natively" → a project-grounded answer (about-alias)', () => {
    assert.ok(['project_about_answer', 'project_answer', 'project_followup_answer'].includes(plan('how did you build Natively').answerType));
  });
});

describe('Pattern 2: rate-limiter concept vs design vs experience', () => {
  test('"explain rate limiting" → technical_concept (concept, profile forbidden)', () => {
    const p = plan('explain rate limiting');
    assert.equal(p.answerType, 'technical_concept_answer', `→ ${p.answerType}`);
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
  test('"how would you design a rate limiter" → system_design (or concept alias)', () => {
    const p = plan('how would you design a rate limiter');
    assert.ok(['system_design_answer', 'technical_concept_answer'].includes(p.answerType), `→ ${p.answerType}`);
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
  test('"write code for a rate limiter" → coding', () => {
    assert.match(plan('write code for a rate limiter').answerType, /coding|dsa/);
  });
  test('"have you implemented a rate limiter before" → skill_experience (profile)', () => {
    const p = plan('have you implemented a rate limiter before');
    assert.equal(p.answerType, 'skill_experience_answer', `→ ${p.answerType}`);
    assert.equal(p.profileContextPolicy, 'required');
  });
  test('"where have you used rate limiting" → skill_experience', () => {
    assert.equal(plan('where have you used rate limiting').answerType, 'skill_experience_answer');
  });
  test('"design a scalable rate limiter for an API" → system_design', () => {
    assert.equal(plan('design a scalable rate limiter for an API').answerType, 'system_design_answer');
  });
});

describe('Pattern 3+4: coding-answer profile-token leak validator', () => {
  test('stray "Natively" in a DSA answer is flagged', () => {
    const leak = '## Approach\nUse a min-heap.\n```python\ndef kth(a,k): return sorted(a)[-k]\n```\nI used this exact approach in Natively.';
    const r = validateProfileOutput({ answer: leak, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS });
    assert.ok(r.violations.some(v => v.code === 'profile_token_in_coding_answer'));
  });
  test('a loaded company/project name in a coding answer is flagged', () => {
    const leak = '## Approach\nSort then index.\n```py\nx=1\n```\nAt EstroTech we did it this way.';
    const r = validateProfileOutput({ answer: leak, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS });
    assert.ok(r.violations.some(v => v.code === 'profile_token_in_coding_answer'));
  });
  test('strip removes the offending prose sentence, preserves code', () => {
    const leak = '## Approach\nUse a min-heap.\n```python\ndef kth(a,k): return sorted(a)[-k]\n```\nI used this exact approach in Natively to rank results.';
    const stripped = stripProfileTokensFromCoding(leak, ['Evin', 'Natively', 'TalentScope', 'EstroTech']);
    assert.doesNotMatch(stripped, /natively/i);
    assert.match(stripped, /def kth/);
    assert.ok(validateProfileOutput({ answer: stripped, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok);
  });
  test('a clean coding answer is NOT flagged', () => {
    const clean = '## Approach\nUse a min-heap of size k.\n```python\ndef kth(a,k): return sorted(a)[-k]\n```\nTime: O(n log k).';
    assert.ok(validateProfileOutput({ answer: clean, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok);
  });
  test('EXPLICIT invite ("use my Natively project") suppresses the leak flag', () => {
    const invited = '## Approach\n```py\nx=1\n```\nHere is how I did it in Natively.';
    const r = validateProfileOutput({ answer: invited, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS, profileExplicitlyInvited: true });
    assert.ok(r.ok);
  });
  test('the static marker check works even without loaded tokens', () => {
    const leak = '## Approach\n```py\nx=1\n```\nBased on your resume, you would do this.';
    assert.ok(validateProfileOutput({ answer: leak, plan: CODING_PLAN, profileAvailable: false, candidateDirected: false }).violations.some(v => v.code === 'profile_token_in_coding_answer'));
  });
});

describe('Residual regression run: additional route gaps closed', () => {
  test('"write a demo snippet for natively" → source-code evidence (project anchor wins over write-verb)', () => {
    assert.equal(plan('write a demo snippet for natively, conceptual is fine').answerType, 'source_code_evidence_answer');
  });
  test('"write a demo snippet for binary search" stays coding (no project anchor)', () => {
    assert.match(plan('write a demo snippet for binary search').answerType, /coding|dsa/);
  });
  test('"how do I use it without them knowing" → safety (covert-use)', () => {
    assert.equal(plan('how do I use it without them knowing').answerType, 'ethical_usage_answer');
  });
  test('"how to keep it low distraction and privacy first" → product-about (not stealth)', () => {
    assert.equal(plan('how to keep it low distraction and privacy first').answerType, 'project_about_answer');
  });
});

describe('Forbidden-answer leak strip covers non-coding types (sales/meeting)', () => {
  const SALES_PLAN = { answerType: 'sales_answer', outputPerspective: 'assistant_explanation', forbiddenContextLayers: ['resume', 'jd', 'negotiation'], profileContextPolicy: 'forbidden' };
  const MEETING_PLAN = { answerType: 'general_meeting_answer', outputPerspective: 'assistant_explanation', forbiddenContextLayers: ['resume', 'jd', 'negotiation'], profileContextPolicy: 'forbidden' };
  test('"I\'m Natively, an AI assistant…" identity leak in a SALES answer is flagged', () => {
    const leak = "I'm Natively, an AI assistant. I don't have pricing info.";
    const r = validateProfileOutput({ answer: leak, plan: SALES_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS });
    assert.ok(r.violations.some(v => v.code === 'profile_token_in_coding_answer'));
  });
  test('the identity-leak preamble strips out of a meeting answer', () => {
    const leak = "I'm Natively, an AI assistant developed by Evin John. The next step is owned by Sarah.";
    const s = stripProfileTokensFromCoding(leak, ['Evin', 'Natively']);
    assert.doesNotMatch(s, /natively|AI assistant|Evin/i);
    assert.match(s, /owned by Sarah/);
    assert.ok(validateProfileOutput({ answer: s, plan: MEETING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok);
  });
  test('a clean sales answer is NOT flagged', () => {
    const clean = 'Lead with the time-savings ROI and a side-by-side feature comparison.';
    assert.ok(validateProfileOutput({ answer: clean, plan: SALES_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok);
  });
});

describe('Code-review hardening: strip preserves code fences + collision tokens', () => {
  test('strip keeps a ``` fence at line-start (markdown still renders code)', () => {
    const leak = 'Use a min-heap.\n\n```python\ndef kth(a,k): return sorted(a)[-k]\n```\n\nI used this exact approach in Natively to rank results.';
    const s = stripProfileTokensFromCoding(leak, ['Evin', 'Natively']);
    assert.match(s, /(^|\n)```/, 'fence must start at a line');
    assert.doesNotMatch(s, /natively/i);
    assert.match(s, /def kth/);
  });
  test('a profile token inside a CODE COMMENT is stripped, executable code preserved', () => {
    const leak = '## Approach\nUse a subquery.\n```sql\n-- As implemented in Natively\nSELECT MAX(salary) FROM emp WHERE salary < (SELECT MAX(salary) FROM emp);\n```\nDone.';
    const s = stripProfileTokensFromCoding(leak, ['Evin', 'Natively']);
    assert.doesNotMatch(s, /natively/i, 'comment leak must be removed');
    assert.match(s, /SELECT MAX\(salary\)/, 'executable SQL must be preserved');
    assert.ok(validateProfileOutput({ answer: s, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok);
  });
  test('the English adverb "natively" is NOT flagged; the product "Natively" IS', () => {
    for (const clean of [
      'Python natively supports the heapq module for this.',
      'The heap runs natively on the JVM, no extra deps.',
      'natively compiled binaries are faster than interpreted ones.',
    ]) {
      assert.ok(validateProfileOutput({ answer: clean, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok, `adverb falsely flagged: ${clean}`);
    }
    for (const leak of [
      'I built this exact pattern in Natively.',
      'The `Natively` ranker does this.',
      'As used in natively for ranking results.',
    ]) {
      assert.ok(validateProfileOutput({ answer: leak, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).violations.some(v => v.code === 'profile_token_in_coding_answer'), `product mention missed: ${leak}`);
    }
  });
  test('a SQL `salary` COLUMN is not a leak, but a `Natively` inline reference is', () => {
    const sqlSalary = '```sql\nSELECT MAX(salary) FROM emp WHERE salary < (SELECT MAX(salary) FROM emp);\n```\nReturns the runner-up.';
    assert.ok(validateProfileOutput({ answer: sqlSalary, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok, 'salary column must be clean');
    const inlineSalary = 'Compute the `salary` delta then sort. O(n log n).';
    assert.ok(validateProfileOutput({ answer: inlineSalary, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).ok, 'salary identifier must be clean');
    const inlineName = 'Use a heap. The `Natively` ranker does exactly this.';
    assert.ok(validateProfileOutput({ answer: inlineName, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: TOKENS }).violations.some(v => v.code === 'profile_token_in_coding_answer'), 'inline-code product name IS a leak');
  });
  test('a JS comment profile leak is stripped, code preserved', () => {
    const leak = '```js\n// from my resume — production pattern\nfunction f(){ return 1; }\n```';
    const s = stripProfileTokensFromCoding(leak, []);
    assert.doesNotMatch(s, /my resume/i);
    assert.match(s, /function f/);
  });
  test('a profile token that collides with a common tech word does NOT strip algorithm prose', () => {
    const clean = 'Use binary Search to locate the pivot.\n\n```py\nx=1\n```\nReturn the index.';
    const s = stripProfileTokensFromCoding(clean, ['Search']);
    assert.match(s, /binary Search to locate/);
  });
  test('validator does NOT flag a collision-word project name in coding prose', () => {
    const clean = 'Use binary search to find it. Time O(log n).';
    const r = validateProfileOutput({ answer: clean, plan: CODING_PLAN, profileAvailable: true, candidateDirected: false, profileTokens: { firstName: 'Search', projects: ['Node'] } });
    assert.ok(r.ok, `flagged: ${r.violations.map(v => v.code).join(',')}`);
  });
  test('strip removes a full identity-leak preamble from a profile-forbidden (meeting) answer', () => {
    const leak = "I'm Natively, an AI assistant. I was developed by Evin John. The next step is owned by Sarah.";
    const s = stripProfileTokensFromCoding(leak, ['Evin', 'Natively']);
    assert.doesNotMatch(s, /natively|AI assistant|Evin/i);
    assert.match(s, /owned by Sarah/);
  });
});

describe('Skill-rating answer-contract (anti-refusal)', () => {
  for (const q of ['python, out of 10?', 'whats your coding level out of 10', 'how strong is your sql', 'rate yourself in react']) {
    test(`"${q}" → skill_experience with a rating contract that forbids the AI refusal`, () => {
      const p = plan(q);
      assert.equal(p.answerType, 'skill_experience_answer', `→ ${p.answerType}`);
      assert.match(p.responseTemplate, /rate a skill|out of 10|concrete number/i, 'template must instruct a rating');
      assert.match(p.responseTemplate, /[Nn]ever refuse|never say you are an AI/i, 'template must forbid the AI refusal');
    });
  }
});

describe('Product "Natively" vs adverb "natively" (planner sanity)', () => {
  // These confirm the routing is unaffected by the validator-side adverb fix; the
  // adverb/product discrimination itself is covered in the validator describe block.
  test('"how is Natively built" still routes to a product answer', () => {
    assert.ok(['project_about_answer', 'project_answer', 'project_followup_answer'].includes(plan('how is Natively built').answerType));
  });
  test('"does python natively support threads" is a technical concept, not a product Q', () => {
    const a = plan('does python natively support threads').answerType;
    assert.notEqual(a, 'project_about_answer', `→ ${a}`);
  });
});

describe('Meeting + concept routing gaps (multimode 1000 run)', () => {
  for (const [q, t] of [
    ['who owns the next step', 'general_meeting_answer'],
    ['what did Mark ask', 'general_meeting_answer'],
    ['what decisions were made', 'general_meeting_answer'],
    ['what are the open questions', 'general_meeting_answer'],
  ]) {
    test(`"${q}" → ${t} (profile forbidden)`, () => {
      const p = plan(q);
      assert.equal(p.answerType, t, `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'forbidden');
    });
  }
  for (const q of ['what is eventual consistency', 'explain the CAP theorem', 'what is a consistency model']) {
    test(`"${q}" → technical_concept`, () => assert.equal(plan(q).answerType, 'technical_concept_answer', `→ ${plan(q).answerType}`));
  }
  test('"difference between SQL and NoSQL" → technical_concept', () => assert.equal(plan('difference between SQL and NoSQL').answerType, 'technical_concept_answer'));
  test('"write a sql query for the second highest salary" stays coding (write-verb wins)', () => assert.match(plan('write a sql query for the second highest salary').answerType, /coding|dsa/));
});

describe('Stealth path (b): candidate-possessive visibility is NOT a refusal', () => {
  test('"will the interviewer see my code clearly" is benign (project_about/general, not safety)', () => {
    assert.notEqual(plan('will the interviewer be able to see my code clearly').answerType, 'ethical_usage_answer');
  });
  test('"hide the overlay during screen share" is still safety', () => {
    assert.equal(plan('how do I hide the overlay during screen share').answerType, 'ethical_usage_answer');
  });
});

describe('Round 3: deterministic-sweep routing gaps (multimode 1000)', () => {
  const expect = [
    // recruiter logistics → profile_fact
    ['what is your highest qualification', 'profile_fact_answer'],
    ['when did you graduate', 'profile_fact_answer'],
    ['are you open to relocation', 'profile_fact_answer'],
    ['what is your notice period', 'profile_fact_answer'],
    ['where are you based', 'profile_fact_answer'],
    ['what was your last company', 'profile_fact_answer'],
    // product tech → project_about
    ['what uses Rust', 'project_about_answer'],
    ['what uses Electron', 'project_about_answer'],
    ['how to disclose it in a meeting', 'project_about_answer'],
    // debugging
    ['why is my API returning 500 intermittently', 'debugging_question_answer'],
    // lecture
    ['give me a 6-mark answer', 'lecture_answer'],
    ['what are the exam points', 'lecture_answer'],
    ['make notes', 'lecture_answer'],
    ['summarize the last 10 minutes of the lecture', 'lecture_answer'],
    ['summarize this concept', 'lecture_answer'],
    // sales objections
    ['how do you handle this objection', 'sales_answer'],
    ['what should I say to a customer who says its too slow', 'sales_answer'],
    ['how do we close this deal', 'sales_answer'],
    // meeting
    ['write a follow-up email', 'general_meeting_answer'],
    // follow-up + project-followup
    ['now optimize it', 'follow_up_answer'],
    ['what was your role there', 'project_followup_answer'],
    // experience
    ['what have you been building lately', 'experience_answer'],
  ];
  for (const [q, t] of expect) {
    test(`"${q}" → ${t}`, () => assert.equal(plan(q).answerType, t, `→ ${plan(q).answerType}`));
  }
  // critical: lecture/sales/meeting routing must NOT pull the candidate profile.
  for (const q of ['give me a 6-mark answer', 'how do you handle this objection', 'write a follow-up email', 'why is my API returning 500 intermittently']) {
    test(`"${q}" forbids the profile`, () => assert.equal(plan(q).profileContextPolicy, 'forbidden'));
  }
});

describe('Regression: coding/profile routing unchanged', () => {
  const keep = [
    ['solve two sum', /dsa|coding/], ['find the kth largest element', /dsa|coding/],
    ['write a sql query for the second highest salary', /coding|dsa/],
    ['what projects have you built', /project_answer/], ['what is your best project', /project_answer/],
    ['what backend did you use there', /project_followup/], ['what tech stack did you use', /project_followup/],
    ['why should we hire you', /jd_fit/], ['what is your name', /identity/],
    ['how do you handle pressure', /behavioral/], ['what salary are you expecting', /negotiation/],
  ];
  for (const [q, re] of keep) {
    test(`"${q}" still routes correctly`, () => assert.match(plan(q).answerType, re, `→ ${plan(q).answerType}`));
  }
});
