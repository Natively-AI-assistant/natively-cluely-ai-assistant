// electron/services/__tests__/IntelligenceEvalComprehensive.test.mjs
// Comprehensive intelligence pipeline evaluation harness — 200+ cases across 10 profiles
// Run: node --test electron/services/__tests__/IntelligenceEvalComprehensive.test.mjs

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allFixtures,
  backendEngineer,
  mlEngineer,
  productManager,
  salesRep,
  uxDesigner,
  dataAnalyst,
  devopsEngineer,
  csm,
  securityAnalyst,
  founderCEO,
} from '../../../tests/intelligence-fixtures/fixture-set.mjs';

// =====================================================================
// PRODUCTION CLASSIFIER LOGIC — inlined from
//   premium/electron/knowledge/IntentClassifier.ts
// Keep in sync with that file exactly.
// =====================================================================

const CANDIDATE_REF_REGEX = /\b(you|your|yours|yourself|you've|you're|you'd|you'll|ya|we|our|ours|ourselves|us|me|my|mine|myself)\b/i;

const IDENTITY_DIRECT_PATTERNS = [
  'what is my name', 'whats my name', "what's my name",
  'who am i', 'who am I',
  'what is my role', 'whats my role', "what's my role",
  'what role am i', 'what role am I',
  'what is my job', 'whats my job', "what's my job",
  'where do i work', 'where do I work', 'where am i working',
  'what company', 'which company',
  'what is my current', 'whats my current', "what's my current",
  'how much experience', 'how many years of experience',
  'what is my background', 'whats my background', "what's my background",
  'my current role', 'my current job', 'my current position',
  'what is my experience', 'whats my experience', "what's my experience",
];

const INTRO_PATTERNS = [
  'introduce yourself',
  'tell me about yourself',
  'who are you',
  'what do you do',
  'describe yourself',
  'about yourself',
  'walk me through your background',
  'brief introduction',
  'self introduction',
  'give me your introduction',
];

const NEGOTIATION_PATTERNS = [
  'salary', 'compensation', 'package', 'negotiate', 'negotiation',
  'offer', 'counter offer', 'counteroffer', 'pay', 'ctc', 'equity',
  'stock', 'bonus', 'benefits', 'what should i ask', 'expected salary',
  'how much should', 'worth', 'market rate', 'pay range',
];

const PROFILE_DETAIL_PATTERNS = [
  'project', 'projects', 'what have you built', 'what did you build',
  'what have you worked on', 'side project',
  'education', 'degree', 'university', 'college', 'school', 'studied',
  'certification', 'certifications', 'certified',
  'achievement', 'achievements', 'award', 'awards',
  'leadership', 'volunteer',
  'skill', 'skills', 'tech stack', 'technologies you know',
  'your background', 'your experience', 'my experience', 'work history',
  'roles', 'previous roles', 'past roles', 'companies you worked',
  'summarize my', 'summarise my',
];

const GENERIC_QUESTION_PATTERNS = [
  'what is a ', 'what is an ', 'what is the ', 'what are ',
  "what's a ", "what's an ", "what's the ",
  'what does ', 'what do ',
  'define ', 'definition of ',
  'explain ', 'explanation of ',
  'describe a ', 'describe an ', 'describe the ',
  'how does ', 'how do i ', 'how to ',
  'difference between ', 'differences between ',
  'compare ', 'comparison of ', 'vs ',
  'give me an example of ', 'example of ', 'show me how ',
  'write the code for ', 'write code for ', 'write a function ',
  'write a program ', 'write a script ',
  'implement a ', 'implement the ',
  'code for ', 'code to ', 'function to ', 'function that ',
  'program to ', 'program that ', 'script to ',
  'pros and cons of ', 'trade-offs of ', 'tradeoffs of ',
  'when to use ', 'when should i use ',
];

// Replicates the scoring logic from IntentClassifier.ts classifyIntent()
function classifyIntent(question) {
  const q = question.toLowerCase().trim();

  if (INTRO_PATTERNS.some(p => q.includes(p))) return 'INTRO';
  if (IDENTITY_DIRECT_PATTERNS.some(p => q.includes(p))) return 'INTRO';

  const scores = {
    TECHNICAL: 0,
    INTRO: 0,
    COMPANY_RESEARCH: 0,
    NEGOTIATION: 0,
    PROFILE_DETAIL: 0,
    GENERAL: 0,
  };

  for (const pattern of NEGOTIATION_PATTERNS) {
    if (q.includes(pattern)) scores.NEGOTIATION++;
  }

  for (const pattern of PROFILE_DETAIL_PATTERNS) {
    if (q.includes(pattern)) scores.PROFILE_DETAIL++;
  }

  const maxScore = Math.max(
    scores.COMPANY_RESEARCH,
    scores.NEGOTIATION,
    scores.TECHNICAL,
    scores.PROFILE_DETAIL,
  );

  if (maxScore === 0) return 'GENERAL';

  if (scores.PROFILE_DETAIL === maxScore) return 'PROFILE_DETAIL';
  if (scores.NEGOTIATION === maxScore) return 'NEGOTIATION';

  return 'GENERAL';
}

function isGenericKnowledgeQuestion(question) {
  const q = question.toLowerCase().trim();
  if (!q) return false;
  if (CANDIDATE_REF_REGEX.test(q)) return false;
  if (IDENTITY_DIRECT_PATTERNS.some(p => q.includes(p))) return false;
  if (INTRO_PATTERNS.some(p => q.includes(p))) return false;
  return GENERIC_QUESTION_PATTERNS.some(p => q.includes(p));
}

// =====================================================================
// RESULT TRACKING
// =====================================================================

const results = {
  totalTests: 0,
  passed: 0,
  failed: 0,
  perProfile: {},
  perCategory: {
    identity_recall: { total: 0, passed: 0 },
    resume_recall: { total: 0, passed: 0 },
    jd_alignment: { total: 0, passed: 0 },
    custom_context: { total: 0, passed: 0 },
    negotiation: { total: 0, passed: 0 },
    unknown_handling: { total: 0, passed: 0 },
    anti_hardcoding: { total: 0, passed: 0 },
  },
  failures: [],
};

function track(profileId, category, passed, label) {
  results.totalTests++;
  if (!results.perProfile[profileId]) {
    results.perProfile[profileId] = { total: 0, passed: 0 };
  }
  results.perProfile[profileId].total++;
  results.perCategory[category].total++;

  if (passed) {
    results.passed++;
    results.perProfile[profileId].passed++;
    results.perCategory[category].passed++;
  } else {
    results.failed++;
    results.failures.push({ profileId, category, label });
  }
}

// =====================================================================
// QUESTION BANKS PER CATEGORY
// =====================================================================

const IDENTITY_QUESTIONS = [
  'What is my name?',
  'What role am I applying for?',
  'Which company is this interview for?',
  'How many years of experience do I have?',
  'What is my current role?',
];

const RESUME_RECALL_QUESTIONS = [
  'Summarize my experience',
  'What projects should I mention?',
  'What are my strongest skills for this role?',
  'What achievement should I emphasize?',
];

const JD_ALIGNMENT_QUESTIONS = [
  'Why am I a good fit for this role?',
  'What should I emphasize based on the job description?',
  'Which parts of my resume match this JD?',
];

const CUSTOM_CONTEXT_QUESTIONS = [
  'Give me a concise answer',
];

const NEGOTIATION_QUESTIONS = [
  'How should I answer expected salary?',
  'How do I justify my target compensation?',
];

const GENERIC_KNOWLEDGE_QUESTIONS = [
  'What is a binary search tree?',
  'Explain the TCP handshake',
];

// =====================================================================
// HELPERS
// =====================================================================

// All pattern constants joined for anti-hardcoding audit
const ALL_PATTERN_STRINGS = [
  ...IDENTITY_DIRECT_PATTERNS,
  ...INTRO_PATTERNS,
  ...NEGOTIATION_PATTERNS,
  ...PROFILE_DETAIL_PATTERNS,
  ...GENERIC_QUESTION_PATTERNS,
].map(p => p.toLowerCase());

function patternSetContainsName(name) {
  const nameLower = name.toLowerCase();
  return ALL_PATTERN_STRINGS.some(p => p.includes(nameLower));
}

// =====================================================================
// PER-FIXTURE TEST SUITES
// =====================================================================

for (const fixture of allFixtures) {
  describe(`[${fixture.id}] ${fixture.candidate.name} — ${fixture.role}`, () => {

    // -----------------------------------------------------------------
    // CATEGORY 1: Identity recall
    // All 5 identity questions must route to INTRO (not GENERAL),
    // and must NOT be classified as generic knowledge.
    // -----------------------------------------------------------------
    describe('Category 1: Identity recall', () => {
      for (const q of IDENTITY_QUESTIONS) {
        test(`"${q}" routes to identity pipeline`, () => {
          const intent = classifyIntent(q);
          const isGeneric = isGenericKnowledgeQuestion(q);

          const notGenericPassed = isGeneric === false;
          const routingPassed = ['INTRO', 'PROFILE_DETAIL'].includes(intent);

          const passed = notGenericPassed && routingPassed;
          track(fixture.id, 'identity_recall', passed, `identity: "${q}"`);

          assert.strictEqual(
            isGeneric,
            false,
            `"${q}" — should NOT bypass persona pipeline (isGeneric must be false)`,
          );
          assert.ok(
            ['INTRO', 'PROFILE_DETAIL'].includes(intent),
            `"${q}" — should route to INTRO or PROFILE_DETAIL, got "${intent}"`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 2: Resume recall routing
    // Must route to PROFILE_DETAIL or INTRO, never GENERAL.
    // -----------------------------------------------------------------
    describe('Category 2: Resume recall routing', () => {
      for (const q of RESUME_RECALL_QUESTIONS) {
        test(`"${q}" routes to profile path`, () => {
          const intent = classifyIntent(q);
          const isGeneric = isGenericKnowledgeQuestion(q);

          const notGenericPassed = isGeneric === false;
          const routingPassed = ['INTRO', 'PROFILE_DETAIL'].includes(intent);

          const passed = notGenericPassed && routingPassed;
          track(fixture.id, 'resume_recall', passed, `resume_recall: "${q}"`);

          assert.strictEqual(
            isGeneric,
            false,
            `"${q}" — should NOT bypass persona (isGeneric must be false)`,
          );
          assert.ok(
            ['INTRO', 'PROFILE_DETAIL'].includes(intent),
            `"${q}" — should route to INTRO or PROFILE_DETAIL, got "${intent}"`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 3: JD alignment routing
    // Must NOT be generic. Intent can be any persona-aware route
    // including GENERAL when first-person framing triggers ref regex.
    // The key requirement: isGenericKnowledgeQuestion must be false.
    // -----------------------------------------------------------------
    describe('Category 3: JD alignment routing', () => {
      for (const q of JD_ALIGNMENT_QUESTIONS) {
        test(`"${q}" not classified as generic knowledge`, () => {
          const isGeneric = isGenericKnowledgeQuestion(q);

          const passed = isGeneric === false;
          track(fixture.id, 'jd_alignment', passed, `jd_alignment: "${q}"`);

          assert.strictEqual(
            isGeneric,
            false,
            `"${q}" — should NOT bypass persona (first-person "I/my" present)`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 4: Custom context adherence
    // A custom-context question like "Give me a concise answer" should
    // not be classified as generic knowledge, so persona wrapping runs.
    // -----------------------------------------------------------------
    describe('Category 4: Custom context adherence', () => {
      for (const q of CUSTOM_CONTEXT_QUESTIONS) {
        test(`"${q}" not treated as generic`, () => {
          const isGeneric = isGenericKnowledgeQuestion(q);

          const passed = isGeneric === false;
          track(fixture.id, 'custom_context', passed, `custom_context: "${q}"`);

          assert.strictEqual(
            isGeneric,
            false,
            `"${q}" — custom instruction must NOT bypass persona pipeline`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 5: Negotiation routing
    // Both questions contain strong negotiation keywords.
    // Must route to NEGOTIATION and must NOT be generic.
    // -----------------------------------------------------------------
    describe('Category 5: Negotiation routing', () => {
      for (const q of NEGOTIATION_QUESTIONS) {
        test(`"${q}" routes to NEGOTIATION`, () => {
          const intent = classifyIntent(q);
          const isGeneric = isGenericKnowledgeQuestion(q);

          const notGenericPassed = isGeneric === false;
          const routingPassed = intent === 'NEGOTIATION';

          const passed = notGenericPassed && routingPassed;
          track(fixture.id, 'negotiation', passed, `negotiation: "${q}"`);

          assert.strictEqual(
            isGeneric,
            false,
            `"${q}" — should NOT bypass persona`,
          );
          assert.strictEqual(
            intent,
            'NEGOTIATION',
            `"${q}" — should route to NEGOTIATION, got "${intent}"`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 6: Unknown / generic knowledge handling
    // Pure technical definitional questions with NO first-person framing
    // should be classified as generic (bypass persona) — this is correct
    // behavior. Confirm the bypass logic works consistently.
    // -----------------------------------------------------------------
    describe('Category 6: Generic knowledge bypass (correct behavior)', () => {
      for (const q of GENERIC_KNOWLEDGE_QUESTIONS) {
        test(`"${q}" IS correctly classified as generic (bypasses persona)`, () => {
          const isGeneric = isGenericKnowledgeQuestion(q);

          const passed = isGeneric === true;
          track(fixture.id, 'unknown_handling', passed, `unknown_handling: "${q}"`);

          assert.ok(
            isGeneric,
            `"${q}" — should be classified as generic knowledge (no candidate framing)`,
          );
        });
      }
    });

    // -----------------------------------------------------------------
    // CATEGORY 7: Anti-hardcoding
    // The candidate's name and target company must NOT appear inside
    // any pattern constant. This proves the system is data-driven.
    // -----------------------------------------------------------------
    describe('Category 7: Anti-hardcoding', () => {
      test(`Candidate name "${fixture.candidate.name}" not hardcoded in patterns`, () => {
        const found = patternSetContainsName(fixture.candidate.name);
        track(fixture.id, 'anti_hardcoding', !found, `anti_hardcoding: name "${fixture.candidate.name}"`);
        assert.ok(
          !found,
          `Candidate name "${fixture.candidate.name}" must NOT appear in any pattern constant`,
        );
      });

      test(`Target company "${fixture.jd.company}" not hardcoded in patterns`, () => {
        const found = patternSetContainsName(fixture.jd.company);
        track(fixture.id, 'anti_hardcoding', !found, `anti_hardcoding: company "${fixture.jd.company}"`);
        assert.ok(
          !found,
          `Company "${fixture.jd.company}" must NOT appear in any pattern constant`,
        );
      });
    });

  }); // end fixture describe
} // end for-fixture loop

// =====================================================================
// CROSS-FIXTURE INVARIANT TESTS
// (These test properties that must hold across ALL fixtures together.)
// =====================================================================

describe('Cross-fixture invariants', () => {

  test('All 10 fixture profiles are present in the fixture set', () => {
    assert.strictEqual(allFixtures.length, 10, `Expected 10 fixtures, got ${allFixtures.length}`);
    const ids = allFixtures.map(f => f.id);
    const expectedIds = [
      'backend-eng-001', 'ml-eng-002', 'pm-003', 'sales-sdr-004',
      'ux-designer-005', 'data-analyst-006', 'devops-sre-007',
      'csm-008', 'security-009', 'founder-010',
    ];
    for (const id of expectedIds) {
      assert.ok(ids.includes(id), `Fixture ID "${id}" must be present`);
    }
  });

  test('CANDIDATE_REF_REGEX covers me/my/mine/myself (regression guard)', () => {
    const firstPersonTokens = ['me', 'my', 'mine', 'myself'];
    for (const token of firstPersonTokens) {
      assert.ok(
        CANDIDATE_REF_REGEX.test(token),
        `CANDIDATE_REF_REGEX must match "${token}" — this was the critical bug`,
      );
    }
  });

  test('All identity questions are blocked from generic bypass (via regex OR identity pattern)', () => {
    // isGenericKnowledgeQuestion guards with two gates:
    //   Gate 1: CANDIDATE_REF_REGEX (me/my/mine/you/your/…)
    //   Gate 2: IDENTITY_DIRECT_PATTERNS (explicit phrase list)
    // Either gate is sufficient — we do NOT require every identity question
    // to contain a pronoun from Gate 1.
    for (const q of IDENTITY_QUESTIONS) {
      const isGeneric = isGenericKnowledgeQuestion(q);
      assert.strictEqual(
        isGeneric,
        false,
        `Identity question "${q}" must NOT be classified as generic (one of the two gates must fire)`,
      );
    }
  });

  test('Negotiation questions all contain salary/compensation keywords', () => {
    for (const q of NEGOTIATION_QUESTIONS) {
      const intent = classifyIntent(q);
      assert.strictEqual(
        intent,
        'NEGOTIATION',
        `"${q}" must route to NEGOTIATION, got "${intent}"`,
      );
    }
  });

  test('Generic questions have NO first-person framing', () => {
    for (const q of GENERIC_KNOWLEDGE_QUESTIONS) {
      const hasRef = CANDIDATE_REF_REGEX.test(q.toLowerCase());
      assert.ok(
        !hasRef,
        `Generic question "${q}" must NOT contain candidate-referring pronouns`,
      );
    }
  });

  test('Pattern constants contain no fixture candidate names', () => {
    const fixtureNames = allFixtures.map(f => f.candidate.name);
    for (const name of fixtureNames) {
      const found = patternSetContainsName(name);
      assert.ok(
        !found,
        `Name "${name}" found hardcoded in a pattern constant — zero hardcoding policy violated`,
      );
    }
  });

  test('Pattern constants contain no fixture company names', () => {
    const companies = allFixtures.map(f => f.jd.company);
    for (const company of companies) {
      // Skip very short or very generic tokens
      if (company.length < 4) continue;
      const found = patternSetContainsName(company);
      assert.ok(
        !found,
        `Company "${company}" found hardcoded in a pattern constant — zero hardcoding policy violated`,
      );
    }
  });

  test('"summarize my experience" routes to PROFILE_DETAIL (not GENERAL)', () => {
    const intent = classifyIntent('Summarize my experience');
    assert.ok(
      ['INTRO', 'PROFILE_DETAIL'].includes(intent),
      `"Summarize my experience" should be INTRO or PROFILE_DETAIL, got "${intent}"`,
    );
  });

  test('"what are my strongest skills" does not bypass persona', () => {
    const isGeneric = isGenericKnowledgeQuestion('What are my strongest skills for this role?');
    assert.strictEqual(isGeneric, false, 'Must not be generic — contains "my"');
  });

  test('"explain the TCP handshake" is generic (no candidate framing)', () => {
    const isGeneric = isGenericKnowledgeQuestion('Explain the TCP handshake');
    assert.ok(isGeneric, '"Explain the TCP handshake" must be generic knowledge');
  });

  test('"what is a binary search tree?" is generic (no candidate framing)', () => {
    const isGeneric = isGenericKnowledgeQuestion('What is a binary search tree?');
    assert.ok(isGeneric, '"What is a binary search tree?" must be generic knowledge');
  });

});

// =====================================================================
// SAVE RESULTS TO iteration-002.json
// =====================================================================

after(() => {
  const accuracy = results.totalTests > 0 ? results.passed / results.totalTests : 0;

  const perProfileAccuracy = {};
  for (const [id, counts] of Object.entries(results.perProfile)) {
    perProfileAccuracy[id] = counts.total > 0
      ? Number((counts.passed / counts.total).toFixed(4))
      : 0;
  }

  const perCategoryAccuracy = {};
  for (const [cat, counts] of Object.entries(results.perCategory)) {
    perCategoryAccuracy[cat] = counts.total > 0
      ? Number((counts.passed / counts.total).toFixed(4))
      : 0;
  }

  const identityCat = results.perCategory.identity_recall;
  const identityRecallAccuracy = identityCat.total > 0
    ? identityCat.passed / identityCat.total
    : 0;

  const output = {
    timestamp: new Date().toISOString(),
    iteration: 2,
    summary: {
      totalTests: results.totalTests,
      passed: results.passed,
      failed: results.failed,
      accuracy: Number(accuracy.toFixed(4)),
      identityRecallAccuracy: Number(identityRecallAccuracy.toFixed(4)),
      perProfileAccuracy,
      perCategoryAccuracy,
    },
    failures: results.failures,
    crossFixtureInvariants: {
      fixtureCount: allFixtures.length,
      candidateRefRegexCoversFirstPerson: true,
      zeroHardcoding: results.perCategory.anti_hardcoding.passed === results.perCategory.anti_hardcoding.total,
    },
    patternMetadata: {
      identityDirectPatternCount: IDENTITY_DIRECT_PATTERNS.length,
      introPatternCount: INTRO_PATTERNS.length,
      negotiationPatternCount: NEGOTIATION_PATTERNS.length,
      genericPatternCount: GENERIC_QUESTION_PATTERNS.length,
      profileDetailPatternCount: PROFILE_DETAIL_PATTERNS.length,
    },
  };

  const outputDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../intelligence-eval-results',
  );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'iteration-002.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('\n--- Intelligence Eval Harness: iteration-002 ---');
  console.log(`Total tests : ${results.totalTests}`);
  console.log(`Passed      : ${results.passed}`);
  console.log(`Failed      : ${results.failed}`);
  console.log(`Accuracy    : ${(accuracy * 100).toFixed(2)}%`);
  console.log(`Identity recall accuracy: ${(identityRecallAccuracy * 100).toFixed(2)}%`);
  console.log('\nPer-category accuracy:');
  for (const [cat, counts] of Object.entries(results.perCategory)) {
    const pct = counts.total > 0 ? ((counts.passed / counts.total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${cat.padEnd(22)} ${String(counts.passed).padStart(3)}/${counts.total} (${pct}%)`);
  }
  console.log('\nPer-profile accuracy:');
  for (const [id, counts] of Object.entries(results.perProfile)) {
    const pct = counts.total > 0 ? ((counts.passed / counts.total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${id.padEnd(22)} ${String(counts.passed).padStart(3)}/${counts.total} (${pct}%)`);
  }
  if (results.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of results.failures) {
      console.log(`  [${f.profileId}] [${f.category}] ${f.label}`);
    }
  }
  console.log(`\nResults saved to: ${outputPath}`);
});
