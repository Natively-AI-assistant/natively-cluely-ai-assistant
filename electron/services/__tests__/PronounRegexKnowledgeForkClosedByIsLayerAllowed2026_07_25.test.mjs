// electron/services/__tests__/PronounRegexKnowledgeForkClosedByIsLayerAllowed2026_07_25.test.mjs
//
// Phase 6 Slice 4 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 4"): pre-required test for item 2 — "PronounRegexKnowledgeFork2026_07_24.test.mjs
// becomes the red/green bar: after the regex is deleted as an independent
// gate, the same 6-question corpus must show ZERO behavioral difference for
// the generic-bypass 3 questions and CORRECTED behavior (no seeding/culture-
// alignment) for the other 3, once isLayerAllowed gates them instead of the
// regex."
//
// This file proves the CORRECTED, target behavior already exists and is
// available — `AnswerPlanner.planAnswer()` + `contextRoute.ts`'s
// `isLayerAllowed(plan, 'resume')` — for the exact same 6-question corpus
// `PronounRegexKnowledgeFork2026_07_24.test.mjs` uses, sourced from the same
// captured benchmark (contractHash 715f1efe2666e8f6). It does NOT modify or
// delete the live pronoun-regex gates (`isGenericKnowledgeQuestion`,
// `isCandidateDirected`'s `CANDIDATE_FRAMING_REGEX`) — that deletion is
// Slice 4's own consequential, not-yet-attempted work (see
// 05_MIGRATION_PLAN.md's Slice 4 STATUS note). This is the RED/GREEN BAR
// the plan calls for: once Slice 4's actual KnowledgeOrchestrator rewire
// lands and calls `isLayerAllowed` instead of the regex, this test's
// assertions describe exactly what that rewire must produce.
//
// The finding this test proves: `isLayerAllowed(plan, 'resume')` already
// resolves to `false` for ALL 6 questions uniformly (all classify as
// `technical_concept_answer`, forbidden from the resume layer per Slice 2's
// forbiddenLayersFor fix) — closing the 3-way pronoun-driven fork
// `PronounRegexKnowledgeFork2026_07_24.test.mjs` documents. The regex-based
// gates currently produce THREE different behaviors for these 6 questions
// (full bypass / candidate-seeding / structured-pack) purely based on
// pronoun presence, even though every one of them is unambiguously a
// generic technical question that should NEVER see résumé content.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { planAnswer } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));
const { isLayerAllowed } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/contextRoute.js'));

// The exact same 6 questions as PronounRegexKnowledgeFork2026_07_24.test.mjs
// (contractHash 715f1efe2666e8f6) — kept as a literal, independent copy so
// this test does not silently drift if the sibling file's corpus changes.
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

// Per PronounRegexKnowledgeFork2026_07_24.test.mjs, the CURRENT (pre-Slice-4)
// regex-gated behavior buckets these 6 questions into 3 groups purely by
// pronoun presence — even though all 6 are the same technical/coding intent.
const CURRENT_REGEX_BUCKET = {
  sqlIsolation: 'generic_bypass',
  processesThreadsAsync: 'candidate_seeding',
  raceCondition: 'candidate_seeding',
  lruCache: 'generic_bypass',
  topKFrequent: 'generic_bypass',
  websocketsTestPlatform: 'structured_pack',
};

function planFor(question) {
  return planAnswer({ question, source: 'what_to_answer', speakerPerspective: 'interviewer' });
}

describe('isLayerAllowed already closes the pronoun-regex 3-way fork for the shared contractHash 715f1efe2666e8f6 corpus', () => {
  test('all 6 questions classify as technical_concept_answer, regardless of pronoun presence', () => {
    for (const [key, q] of Object.entries(QUESTIONS)) {
      const plan = planFor(q);
      assert.equal(plan.answerType, 'technical_concept_answer', `${key}: expected technical_concept_answer, got ${plan.answerType}`);
    }
  });

  test('isLayerAllowed(plan, "resume") is false for ALL 6 questions — no fork, unlike the current pronoun-regex gates', () => {
    for (const [key, q] of Object.entries(QUESTIONS)) {
      const plan = planFor(q);
      assert.equal(
        isLayerAllowed(plan, 'resume'),
        false,
        `${key}: isLayerAllowed must forbid resume for every generic technical question, regardless of pronoun presence (current bucket: ${CURRENT_REGEX_BUCKET[key]})`,
      );
    }
  });

  test('the 3 questions the CURRENT regex buckets as candidate_seeding/structured_pack (a fork-shaped divergence) are corrected to the same forbidden-resume outcome as the generic_bypass bucket', () => {
    // This is the exact behavioral CORRECTION the migration plan requires:
    // processesThreadsAsync/raceCondition/websocketsTestPlatform currently
    // get candidate-seeding or a structured résumé pack injected (per
    // PronounRegexKnowledgeFork2026_07_24.test.mjs) purely because they
    // contain "you"/"your" — despite being exactly as generic-technical as
    // the other 3. Once isLayerAllowed gates instead of the regex, all 6
    // must be treated identically.
    const forkedKeys = ['processesThreadsAsync', 'raceCondition', 'websocketsTestPlatform'];
    const nonForkedKeys = ['sqlIsolation', 'lruCache', 'topKFrequent'];
    const forkedResults = forkedKeys.map((k) => isLayerAllowed(planFor(QUESTIONS[k]), 'resume'));
    const nonForkedResults = nonForkedKeys.map((k) => isLayerAllowed(planFor(QUESTIONS[k]), 'resume'));
    assert.deepEqual(forkedResults, [false, false, false]);
    assert.deepEqual(nonForkedResults, [false, false, false]);
    assert.deepEqual(forkedResults, nonForkedResults, 'the two groups must resolve identically once the fork is closed');
  });

  test('jd/negotiation/custom_context/reference_files are ALSO uniformly forbidden for all 6 (the full Slice 2 forbiddenLayersFor set, not just resume)', () => {
    for (const [key, q] of Object.entries(QUESTIONS)) {
      const plan = planFor(q);
      for (const layer of ['jd', 'negotiation', 'custom_context', 'reference_files', 'prior_assistant_responses']) {
        assert.equal(isLayerAllowed(plan, layer), false, `${key}: ${layer} must be forbidden`);
      }
    }
  });
});
