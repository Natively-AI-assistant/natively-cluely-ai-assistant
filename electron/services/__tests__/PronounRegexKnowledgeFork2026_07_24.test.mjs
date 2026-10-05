// electron/services/__tests__/PronounRegexKnowledgeFork2026_07_24.test.mjs
//
// Phase 3 (context-rebuild) live-repro test for docs/context-rebuild
// hypothesis #1 (00_BASELINE_AND_REPRODUCTION.md §3.4, 01_CALL_GRAPHS.md
// "Path 3", 01_CURRENT_ARCHITECTURE.md Item 7):
//
//   The same contractHash (715f1efe2666e8f6) / same answerType
//   (technical_concept_answer) / same sourceAuthority (profile_only) turn
//   forks into THREE different KnowledgeOrchestrator retrieval behaviors
//   purely because of a bare pronoun-presence regex, independent of the
//   question's actual technical content:
//     (a) full bypass (no identity/retrieval) when
//         isGenericKnowledgeQuestion(question) === true
//         (premium/electron/knowledge/IntentClassifier.ts:451-466, gated by
//         CANDIDATE_REF_REGEX at :361)
//     (b) candidate-directed seeding+culture-alignment when it's false and
//         no resume-category hint matches
//         (KnowledgeOrchestrator.ts:983-1015, CANDIDATE_FRAMING_REGEX at :997)
//     (c) a deterministic structured pack (bypassing vector search) when
//         it's false AND detectCategoryHints(question) also matches a resume
//         category (HybridSearchEngine.ts:98, consumed by
//         KnowledgeOrchestrator.ts:1904's buildStructuredCategoryPack)
//
// This file calls the REAL exported functions (isGenericKnowledgeQuestion,
// classifyIntentWithContext, detectCategoryHints) from the compiled premium
// submodule output against the exact 6 questions that shared
// contractHash:"715f1efe2666e8f6" in the Phase 0 benchmark corpus
// (NATIVELY_CONTEXT_SYSTEM_SIMPLIFICATION_PROMPT.md lines 1256-1802 for the
// [SOURCE-ARBITER]/[CONTEXT-OS] trace lines; lines 2511-2603 for the
// full/untruncated question text used here).
//
// isCandidateDirected itself (KnowledgeOrchestrator.ts:1015) is NOT exported
// — it is a local variable inside the private processQuestion() method,
// which additionally requires a fully-instantiated KnowledgeOrchestrator
// (KnowledgeDatabaseManager, an active resume/JD, etc.) to call at all. This
// file therefore reproduces isCandidateDirected's exact formula
// (`candidateDirectedIntents.has(intent) || hasCandidateFraming`) using:
//   - classifyIntentWithContext(question) — REAL exported call, for `intent`
//   - CANDIDATE_FRAMING_REGEX and candidateDirectedIntents — copied
//     VERBATIM from KnowledgeOrchestrator.ts:983-988,997 (cited inline
//     below) since they are not independently exported. This is the one
//     piece of this test that is "re-read the regex" rather than "call the
//     function" — flagged explicitly per the task's own caveat.
// detectCategoryHints IS exported and called for real (HybridSearchEngine.ts:98).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const intentClassifier = await import(
  pathToFileURL(path.resolve(repoRoot, 'dist-electron/premium/electron/knowledge/IntentClassifier.js')).href
);
const hybridSearchEngine = await import(
  pathToFileURL(path.resolve(repoRoot, 'dist-electron/premium/electron/knowledge/HybridSearchEngine.js')).href
);

const { isGenericKnowledgeQuestion, classifyIntentWithContext } = intentClassifier;
const { detectCategoryHints } = hybridSearchEngine;

// Copied verbatim from premium/electron/knowledge/KnowledgeOrchestrator.ts:997
// (CANDIDATE_FRAMING_REGEX) and :983-988 (candidateDirectedIntents, using the
// IntentType string values from premium/electron/knowledge/types.ts:346-353
// since KnowledgeOrchestrator.ts uses the IntentType enum member, not the
// bare string — same underlying value, confirmed by types.ts).
const CANDIDATE_FRAMING_REGEX =
  /\b(i|i've|i'm|i'd|i'll|my|mine|myself|me|we|our|ours|us|you|your|yours|yourself|you've|you're|you'd|you'll)\b/i;
const candidateDirectedIntents = new Set(['intro', 'profile_detail', 'negotiation', 'company_research']);

function isCandidateDirected(question, intent) {
  const hasCandidateFraming = CANDIDATE_FRAMING_REGEX.test(question);
  return candidateDirectedIntents.has(intent) || hasCandidateFraming;
}

// The exact 6 questions sharing contractHash:"715f1efe2666e8f6" in the
// captured benchmark (full, untruncated text; SOURCE-ARBITER's
// `questionSnippet` truncates at 80 chars, so these are read from Appendix
// B's visible transcript — NATIVELY_CONTEXT_SYSTEM_SIMPLIFICATION_PROMPT.md
// lines 2511, 2516, 2521 [de-duplicated — see item 4 of this phase's report
// for the doubled-text artifact itself], 2526, 2531, 2603).
const QUESTIONS = {
  sqlIsolation:
    'Explain SQL transaction isolation levels and give an example of a problem prevented by each stronger level.',
  processesThreadsAsync: 'Compare processes, threads and asynchronous tasks. When would you choose each?',
  raceCondition:
    'What is a race condition? Show how you would diagnose and prevent one in a concurrent backend service.',
  lruCache: 'Explain how an LRU cache works and give the expected time complexity of get and put operations.',
  topKFrequent:
    'Given an array of integers, explain an efficient approach for finding the k most frequent values, including complexity and edge cases.',
  websocketsTestPlatform:
    'How would you test a real-time interview platform involving WebSockets, video calls, collaborative state and role-based permissions?',
};

describe('Phase 3 item 1: pronoun-regex 3-way fork on shared contractHash 715f1efe2666e8f6', () => {
  test('generic-bypass bucket (no candidate pronoun): SQL isolation, LRU cache, top-k frequent', () => {
    for (const key of ['sqlIsolation', 'lruCache', 'topKFrequent']) {
      const q = QUESTIONS[key];
      assert.equal(isGenericKnowledgeQuestion(q), true, `${key}: expected isGenericKnowledgeQuestion=true`);
    }
  });

  test('candidate-directed-seeding bucket (bare "you"/"your", no category hint): processes/threads, race condition', () => {
    for (const key of ['processesThreadsAsync', 'raceCondition']) {
      const q = QUESTIONS[key];
      assert.equal(isGenericKnowledgeQuestion(q), false, `${key}: expected isGenericKnowledgeQuestion=false`);
      const intent = classifyIntentWithContext(q);
      assert.equal(isCandidateDirected(q, intent), true, `${key}: expected isCandidateDirected=true`);
      assert.deepEqual(detectCategoryHints(q), [], `${key}: expected no resume category hint (seeding path, not structured pack)`);
    }
  });

  test('structured-pack bucket (bare "you" AND a resume category hint): WebSockets test-platform question', () => {
    const q = QUESTIONS.websocketsTestPlatform;
    assert.equal(isGenericKnowledgeQuestion(q), false, 'expected isGenericKnowledgeQuestion=false');
    const intent = classifyIntentWithContext(q);
    assert.equal(isCandidateDirected(q, intent), true, 'expected isCandidateDirected=true');
    const hints = detectCategoryHints(q);
    assert.ok(hints.includes('experience'), `expected detectCategoryHints to include 'experience', got ${JSON.stringify(hints)}`);
  });

  test('the 3-vs-3 split is driven by pronoun presence, not the technical vs. general intent label', () => {
    // raceCondition classifies identical to sqlIsolation/lruCache/topKFrequent
    // ("technical") yet lands in the OPPOSITE bucket — the discriminator is
    // CANDIDATE_REF_REGEX (bypass gate) / CANDIDATE_FRAMING_REGEX (seeding
    // gate) matching "you", not the intent label. This directly reproduces
    // 01_CALL_GRAPHS.md lines 266-270's claim.
    assert.equal(classifyIntentWithContext(QUESTIONS.raceCondition), 'technical');
    assert.equal(classifyIntentWithContext(QUESTIONS.sqlIsolation), 'technical');
    assert.equal(isGenericKnowledgeQuestion(QUESTIONS.raceCondition), false);
    assert.equal(isGenericKnowledgeQuestion(QUESTIONS.sqlIsolation), true);
  });
});
