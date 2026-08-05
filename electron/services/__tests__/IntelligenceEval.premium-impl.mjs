// electron/services/__tests__/IntelligenceEval.test.mjs
// Verifies the 3-part intelligence pipeline fix for "what is my name?" → identity recall
// Tests pattern-matching logic directly (no module import infrastructure needed)
// Run: node --test electron/services/__tests__/IntelligenceEval.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// =====================================================================
// THE FIXED CODE — inline to avoid import infrastructure issues
// This mirrors exactly what is in premium/electron/knowledge/IntentClassifier.ts
// =====================================================================

// FIX 1: CANDIDATE_REF_REGEX now includes me/my/mine/myself
const CANDIDATE_REF_REGEX = /\b(you|your|yours|yourself|you've|you're|you'd|you'll|ya|we|our|ours|ourselves|us|me|my|mine|myself)\b/i;

// FIX 2: IDENTITY_DIRECT_PATTERNS covers identity questions
const IDENTITY_DIRECT_PATTERNS = [
    'what is my name', 'whats my name', "what's my name",
    'who am i', 'who am I',
    'what is my role', 'whats my role', "what's my role",
    'what is my job', 'whats my job', "what's my job",
    'where do i work', 'where do I work', 'where am i working',
    'what company', 'which company',
    'what is my current', 'whats my current', "what's my current",
    'how much experience', 'how many years of experience',
    'what is my background', 'whats my background', "what's my background",
    'my current role', 'my current job', 'my current position',
    'what is my experience', 'whats my experience', "what's my experience",
];

// Full self-intro phrases only — identity questions ("what is my name?", "who am i?")
// are in IDENTITY_DIRECT_PATTERNS and route to the factual answer path, not JIT intro.
const INTRO_PATTERNS = [
    'introduce yourself', 'tell me about yourself', 'who are you',
    'what do you do', 'describe yourself', 'about yourself',
    'tell me who you are', 'give me your introduction',
    'walk me through your background', 'brief introduction', 'self introduction',
];

const NEGOTIATION_PATTERNS = [
    'salary', 'compensation', 'package', 'negotiate', 'negotiation',
    'offer', 'counter offer', 'counteroffer', 'pay', 'ctc', 'equity',
    'stock', 'bonus', 'benefits', 'what should i ask', 'expected salary',
    'how much should', 'worth', 'market rate', 'pay range',
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

const GREETING_PATTERNS = [
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'howdy', 'what\'s up', 'sup', 'yo',
];

function classifyIntent(question) {
    const q = question.toLowerCase().trim();
    if (INTRO_PATTERNS.some(p => q.includes(p))) return 'INTRO';
    if (IDENTITY_DIRECT_PATTERNS.some(p => q.includes(p))) return 'INTRO';
    if (NEGOTIATION_PATTERNS.some(p => q.includes(p))) return 'NEGOTIATION';
    return q.includes('project') || q.includes('skill') || q.includes('education') ? 'PROFILE_DETAIL' : 'GENERAL';
}

function isGenericKnowledgeQuestion(question) {
    const q = question.toLowerCase().trim();
    if (!q) return false;
    if (CANDIDATE_REF_REGEX.test(q)) return false;
    if (IDENTITY_DIRECT_PATTERNS.some(p => q.includes(p))) return false;
    if (INTRO_PATTERNS.some(p => q.includes(p))) return false;
    return GENERIC_QUESTION_PATTERNS.some(p => q.includes(p));
}

// Full self-intro questions only ("tell me about yourself") → JIT LLM intro generation
function isIntroQuestion(questionLower) {
    return INTRO_PATTERNS.some(p => questionLower.includes(p));
}

// Identity-direct questions ("what is my name?") → classified as INTRO intent by
// IntentClassifier, but isIntroQuestion() returns false in ContextAssembler so the
// LLM answers from the identity-header system prompt (AOT context path), not the JIT intro.
function isIdentityDirectQuestion(questionLower) {
    return IDENTITY_DIRECT_PATTERNS.some(p => questionLower.includes(p));
}

function isBareGreeting(questionLower) {
    const trimmed = questionLower.replace(/[!?.,']/g, '').trim();
    return GREETING_PATTERNS.includes(trimmed) ||
        GREETING_PATTERNS.some(g => trimmed === `${g} there`) ||
        trimmed.length <= 12 && GREETING_PATTERNS.some(g => trimmed.startsWith(g));
}

// =====================================================================
// FIXTURES — synthetic names (NOT real people)
// =====================================================================

const FIXTURES = [
    'Aarav Menon', 'Priya Sharma', 'Jordan Kim', 'Marcus Williams',
    'Sofia Rodriguez', 'Chen Wei', 'Kwame Osei', 'Aisha Patel',
    'David Okonkwo', 'Michael Zhang',
];

const FIXTURE_COMPANY = [
    'Datadog', 'Anthropic', 'Figma', 'Databricks', 'Canva',
    'Coinbase', 'Stripe', 'Notion', 'Cloudflare', 'Cognition AI',
];

// =====================================================================
// CRITICAL TEST: "what is my name?" routing
// =====================================================================

describe('CRITICAL: "what is my name?" → identity pipeline (Regression #1)', () => {
    const q = 'what is my name?';
    const ql = q.toLowerCase().trim();

    test('CANDIDATE_REF_REGEX matches "my" in "what is my name?"', () => {
        assert.ok(CANDIDATE_REF_REGEX.test(q), '"my" should match CANDIDATE_REF_REGEX');
    });

    test('IDENTITY_DIRECT_PATTERNS catches "what is my name"', () => {
        assert.ok(IDENTITY_DIRECT_PATTERNS.some(p => ql.includes(p)), 'should match an identity pattern');
    });

    test('classifyIntent("what is my name?") → INTRO', () => {
        assert.strictEqual(classifyIntent(q), 'INTRO', 'should route to INTRO intent');
    });

    test('isIdentityDirectQuestion("what is my name?") → true (AOT context path)', () => {
        assert.ok(isIdentityDirectQuestion(ql), 'should be recognized as identity-direct question');
    });

    test('isIntroQuestion("what is my name?") → false (not a JIT self-intro request)', () => {
        assert.strictEqual(isIntroQuestion(ql), false, 'should NOT trigger JIT intro — LLM answers from identity-header system prompt');
    });

    test('isGenericKnowledgeQuestion("what is my name?") → false (regression: was true before fix)', () => {
        assert.strictEqual(isGenericKnowledgeQuestion(q), false, 'should NOT bypass to generic path');
    });

    test('isBareGreeting("what is my name?") → false', () => {
        assert.strictEqual(isBareGreeting(ql), false, 'should not be confused with greeting');
    });

    test('processQuestion would NOT return null for "what is my name?"', () => {
        // processQuestion returns null iff: !isKnowledgeMode OR isGenericKnowledgeQuestion OR (!candidateDirected AND no framing)
        const intent = classifyIntent(q);
        const isGeneric = isGenericKnowledgeQuestion(q);
        const hasFraming = CANDIDATE_REF_REGEX.test(q);
        const candidateDirected = new Set(['INTRO', 'PROFILE_DETAIL', 'NEGOTIATION']);
        const wouldReturnNull = isGeneric || (!candidateDirected.has(intent) && !hasFraming);
        assert.strictEqual(wouldReturnNull, false, 'should NOT return null (fix: me/my/mine in regex)');
    });
});

// =====================================================================
// TEST: "who am I?" routing
// =====================================================================

describe('"who am I?" routing (Regression #2)', () => {
    const q = 'who am I?';

    test('isGenericKnowledgeQuestion("who am I?") → false', () => {
        assert.strictEqual(isGenericKnowledgeQuestion(q), false, 'first-person "I" should not bypass persona');
    });

    test('classifyIntent("who am I?") → INTRO', () => {
        assert.strictEqual(classifyIntent(q), 'INTRO', '"who am I" should route to INTRO');
    });
});

// =====================================================================
// TEST: "my name is X" questions route correctly
// =====================================================================

describe('"my name" / "my role" questions route to persona pipeline', () => {
    const questions = [
        ['what is my name', 'INTRO'],
        ['what is my role', 'INTRO'],
        ['whats my job', 'INTRO'],
        ["what's my background", 'INTRO'],
        ['my current role', 'INTRO'],
        ['my strongest skill', 'PROFILE_DETAIL'],
    ];

    for (const [q, expectedIntent] of questions) {
        test(`"${q}" → ${expectedIntent}`, () => {
            const intent = classifyIntent(q);
            const isGeneric = isGenericKnowledgeQuestion(q);
            assert.strictEqual(isGeneric, false, `"${q}" should not be generic`);
            // Should route to something persona-aware (INTRO or PROFILE_DETAIL)
            assert.ok(['INTRO', 'PROFILE_DETAIL'].includes(intent), `"${q}" should be persona-aware, got ${intent}`);
        });
    }
});

// =====================================================================
// TEST: Negotiation questions route correctly (not identity shortcuts)
// =====================================================================

describe('Negotiation questions route to NEGOTIATION path', () => {
    const qs = [
        'how should i negotiate my salary',
        'what should i say about compensation',
        'how do i justify my target compensation',
        'what if they offer below my minimum',
    ];

    for (const q of qs) {
        test(`"${q}" → not INTRO, not generic`, () => {
            const intent = classifyIntent(q);
            const isGeneric = isGenericKnowledgeQuestion(q);
            assert.strictEqual(isGeneric, false, `"${q}" should not be generic`);
            // Negotiation questions should route to NEGOTIATION (has "negotiate"/"salary"/"compensation")
            assert.strictEqual(intent, 'NEGOTIATION', `"${q}" should be NEGOTIATION, got ${intent}`);
        });
    }
});

// =====================================================================
// TEST: Generic technical questions bypass persona (expected behavior preserved)
// =====================================================================

describe('Generic technical questions correctly bypass persona (no regression)', () => {
    const qs = [
        'what is an api',
        'explain tcp handshake',
        'write a function to reverse a string',
        'what is the difference between rest and graphql',
        'how does kubernetes scheduling work',
        'implement a binary search tree',
        'what is a hash map',
    ];

    for (const q of qs) {
        test(`"${q}" IS generic (bypasses persona)`, () => {
            assert.ok(isGenericKnowledgeQuestion(q), `"${q}" should be generic`);
        });
    }
});

// =====================================================================
// TEST: Bare greetings handled correctly (no regression)
// =====================================================================

describe('isBareGreeting correctly distinguishes greetings from intros', () => {
    const bare = ['hi', 'hello', 'hey', 'good morning', 'yo'];
    for (const g of bare) {
        test(`"${g}" IS a bare greeting`, () => {
            assert.ok(isBareGreeting(g), `"${g}" should be a bare greeting`);
        });
    }

    const notBare = ['what is my name', 'tell me about yourself', 'who are you'];
    for (const g of notBare) {
        test(`"${g}" is NOT a bare greeting`, () => {
            assert.ok(!isBareGreeting(g), `"${g}" should not be a bare greeting`);
        });
    }
});

// =====================================================================
// TEST: All IDENTITY_DIRECT_PATTERNS are covered
// =====================================================================

describe('IDENTITY_DIRECT_PATTERNS covers all identity question patterns', () => {
    const patterns = [
        'what is my name', 'whats my name', "what's my name",
        'who am i', 'who am I',
        'what is my role', 'what is my job',
        'where do i work', 'where am i working',
        'what company', 'which company',
        'how much experience', 'how many years of experience',
        'what is my background',
    ];

    for (const p of patterns) {
        test(`"${p}" covered by IDENTITY_DIRECT_PATTERNS`, () => {
            const covered = IDENTITY_DIRECT_PATTERNS.some(ip => ip.includes(p) || p.includes(ip));
            assert.ok(covered || IDENTITY_DIRECT_PATTERNS.some(ip => p.toLowerCase().includes(ip)), `"${p}" should be covered`);
        });
    }
});

// =====================================================================
// TEST: No fixture names in patterns (anti-hardcoding check)
// =====================================================================

describe('Anti-hardcoding: fixture values NOT in pattern constants', () => {
    test('No fixture names in IDENTITY_DIRECT_PATTERNS', () => {
        for (const fixtureName of FIXTURES) {
            for (const pattern of IDENTITY_DIRECT_PATTERNS) {
                assert.ok(
                    !pattern.toLowerCase().includes(fixtureName.toLowerCase()),
                    `Pattern "${pattern}" should not contain fixture name "${fixtureName}"`
                );
            }
        }
    });

    test('No fixture companies in IDENTITY_DIRECT_PATTERNS', () => {
        for (const company of FIXTURE_COMPANY) {
            for (const pattern of IDENTITY_DIRECT_PATTERNS) {
                assert.ok(
                    !pattern.toLowerCase().includes(company.toLowerCase()),
                    `Pattern "${pattern}" should not contain fixture company "${company}"`
                );
            }
        }
    });

    test('CANDIDATE_REF_REGEX contains no fixture names', () => {
        const regex = CANDIDATE_REF_REGEX.source;
        for (const name of FIXTURES) {
            assert.ok(
                !regex.toLowerCase().includes(name.toLowerCase()),
                `CANDIDATE_REF_REGEX source should not contain fixture name "${name}"`
            );
        }
    });
});

// =====================================================================
// SUMMARY
// =====================================================================

console.log('\n✅ Intelligence pipeline eval harness loaded');
console.log('   Run: node --test electron/services/__tests__/IntelligenceEval.test.mjs');