// electron/llm/__tests__/AnswerPlannerForbiddenLayers2026_07_24.test.mjs
//
// Phase 3 (context-rebuild) live-repro test for docs/context-rebuild
// hypothesis #2 (01_CURRENT_ARCHITECTURE.md §6, 01_CALL_GRAPHS.md lines
// 195-196): `AnswerPlanner.forbiddenLayersFor(answerType)`
// (electron/llm/AnswerPlanner.ts:1795-1885) returns `['resume', 'jd',
// 'negotiation', 'custom_context', 'reference_files']` — i.e. ALL profile
// layers forbidden — for the generic technical/coding answer types
// (coding_question_answer, dsa_question_answer, technical_concept_answer,
// system_design_answer, debugging_question_answer), per the explicit
// in-source comment "Spec §8.3: generic coding/technical answers must NOT
// use any profile" (AnswerPlanner.ts:1804). It also asserts the CONTRASTING
// behavior for identity_answer / skill_experience_answer (resume allowed;
// only jd/negotiation/reference_files forbidden), confirming AnswerPlanner
// correctly distinguishes "about the candidate" answer types from generic
// technical ones.
//
// forbiddenLayersFor itself is a private (non-exported) const
// (AnswerPlanner.ts:1795); the task text explicitly sanctions using
// `planAnswer` — the exported, realistic entrypoint — as the call surface,
// since `AnswerPlan.forbiddenContextLayers` (AnswerPlanner.ts:2786) is
// `forbiddenLayersFor(answerType)`'s direct, unmodified return value. This
// file therefore calls the REAL exported `planAnswer` with representative
// questions (reusing phrasings already proven, by the pre-existing
// ProfileRoutingMatrix.test.mjs and AnswerPlannerValidator.test.mjs suites in
// this same directory, to resolve to each target answerType) and asserts on
// the real `answerType` + `forbiddenContextLayers` fields it returns — not a
// re-read of the switch statement.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const p = (q, source = 'what_to_answer', speaker = 'interviewer') =>
  planAnswer({ question: q, source, speakerPerspective: speaker });

// Phase 6 Slice 2 (context-rebuild, 2026-07-25) RC3 fix: also forbid
// prior_assistant_responses for these five answer types — see
// AnswerPlanner.ts's forbiddenLayersFor comment at this case for why (the
// layer was previously in NEITHER forbidden nor required, so
// isLayerAllowed's fail-open default silently permitted an unrelated prior
// turn's content to leak into these answers).
const GENERIC_TECHNICAL_FORBIDDEN = ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files', 'prior_assistant_responses'];

describe('Phase 3 item 2: forbiddenLayersFor forbids ALL profile layers for generic technical/coding answer types', () => {
  const cases = [
    { label: 'coding_question_answer', question: 'Implement an LRU cache.' },
    { label: 'dsa_question_answer', question: 'Solve Two Sum.' },
    { label: 'technical_concept_answer', question: 'Explain BFS.' },
    { label: 'system_design_answer', question: 'How would you design a scalable notification service?' },
    { label: 'debugging_question_answer', question: 'How would you debug this production exception?' },
  ];

  for (const { label, question } of cases) {
    test(`"${question}" → ${label}, forbiddenContextLayers = all profile layers`, () => {
      const r = p(question);
      assert.equal(r.answerType, label, `expected answerType ${label}, got ${r.answerType}`);
      assert.deepEqual(
        [...r.forbiddenContextLayers].sort(),
        [...GENERIC_TECHNICAL_FORBIDDEN].sort(),
        `forbiddenContextLayers mismatch for ${label}: got ${JSON.stringify(r.forbiddenContextLayers)}`,
      );
    });
  }

  test('another debugging phrasing ("Why is this service crashing?") also lands on debugging_question_answer with the same forbidden set', () => {
    const r = p('Why is this service crashing?');
    assert.equal(r.answerType, 'debugging_question_answer');
    assert.deepEqual([...r.forbiddenContextLayers].sort(), [...GENERIC_TECHNICAL_FORBIDDEN].sort());
  });

  for (const { label, question } of cases) {
    test(`RC3 (Slice 2): "${question}" → ${label} forbids prior_assistant_responses specifically`, () => {
      const r = p(question);
      assert.ok(
        r.forbiddenContextLayers.includes('prior_assistant_responses'),
        `${label} must forbid prior_assistant_responses (RC3) — an unrelated prior turn must not leak into this answer type`,
      );
    });
  }
});

describe('Phase 3 item 2 (contrast): candidate-facing answer types allow resume, still forbid jd/negotiation', () => {
  test('"Tell me about yourself." → identity_answer, resume ALLOWED', () => {
    const r = p('Tell me about yourself.');
    assert.equal(r.answerType, 'identity_answer');
    assert.deepEqual([...r.forbiddenContextLayers].sort(), ['jd', 'negotiation', 'reference_files'].sort());
    assert.ok(!r.forbiddenContextLayers.includes('resume'), 'identity_answer must NOT forbid resume');
  });

  test('"Have you used WebRTC?" → skill_experience_answer, resume ALLOWED', () => {
    const r = p('Have you used WebRTC?');
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.deepEqual([...r.forbiddenContextLayers].sort(), ['jd', 'negotiation', 'reference_files'].sort());
    assert.ok(!r.forbiddenContextLayers.includes('resume'), 'skill_experience_answer must NOT forbid resume');
  });
});
