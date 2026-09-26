// electron/llm/__tests__/ExtractorPunctuationNeutral2026_08_18.test.mjs
//
// WTA audit Phase 3 slice 1 (.audit/wta-audit.md F9): make the LIVE
// extractLatestQuestion punctuation-provenance-aware. Measured on the
// 102-case selection dataset: stripping punctuation changes NO turn
// selection (84.3% all conditions) but drops mean confidence 0.777 → 0.63
// and pushes 18 → 30 cases below the live 0.6 grounding gate (+12% of the
// dataset) — i.e. on Soniox/OpenAI/ElevenLabs/NativelyPro/REST providers,
// ~12% more turns silently skip profile grounding purely because the
// provider never emits '?'.
//
// Contract (mirrors QuestionLedger.askShape):
//   - punctuationSource 'provider_final'/'provider_interim' → punctuation is
//     guaranteed; a missing '?' remains real negative evidence (unchanged).
//   - punctuationSource 'unavailable' → absence of '?' is NEUTRAL: an
//     interrogative lead alone scores as high as mark+lead.
//   - punctuationSource ABSENT (legacy writers, typed questions, tests that
//     never pass it) → unchanged legacy scoring, so this is strictly
//     additive: only segments stamped by the STT seam change behavior.
//
// Mutation tests: these fail if the provenance parameter is dropped or the
// neutral branch is reverted.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { extractLatestQuestion } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js')).href
);

const turnsFor = (text, punctuationSource) => ([
  { role: 'interviewer', text: 'Thanks for joining today.', timestamp: 1000, punctuationSource },
  { role: 'user', text: 'Happy to be here, thanks for having me.', timestamp: 2000, punctuationSource },
  { role: 'interviewer', text, timestamp: 3000, punctuationSource },
]);

describe('unavailable punctuation: missing "?" is neutral, not negative', () => {
  test('unpunctuated interrogative lead scores as high as the punctuated form', () => {
    const punctuated = extractLatestQuestion(turnsFor('Why did you choose Kafka for the pipeline?', 'provider_final'));
    const unpunctuated = extractLatestQuestion(turnsFor('why did you choose kafka for the pipeline', 'unavailable'));
    assert.ok(punctuated.confidence >= 0.95, `sanity: punctuated ${punctuated.confidence}`);
    assert.ok(
      unpunctuated.confidence >= punctuated.confidence - 1e-9,
      `unavailable-provenance lead must not be penalized (${unpunctuated.confidence} vs ${punctuated.confidence})`
    );
  });

  test('the live 0.6 grounding gate is cleared by an unpunctuated lead question', () => {
    const r = extractLatestQuestion(turnsFor('what is your experience with kubernetes', 'unavailable'));
    assert.ok(r.confidence >= 0.6, `must clear the grounding gate, got ${r.confidence}`);
  });
});

describe('unavailable punctuation: clause-level interrogatives (the lead is ^-anchored, but a stripped prefix clause hides it)', () => {
  // Real gate-crossing shapes from the 102-case dataset probe: with the '?'
  // stripped and no comma, the wh/aux lead sits MID-STRING, so hasLead fails
  // and the answerability floor capped these at 0.3 — silently ungrounded.
  const clauseCases = [
    'on a scale of one to ten how strong is your react',       // wh + adj + aux
    'your experience seems engineering-heavy why data',        // trailing wh fragment
    'just to confirm what should i call you',                  // wh + aux mid-string
    'before we dive in can you quickly introduce yourself',    // aux + you mid-string
    'if we need sql daily how ready are you',                  // conditional prefix
  ];
  for (const text of clauseCases) {
    test(`"${text}" clears the 0.6 grounding gate`, () => {
      const r = extractLatestQuestion(turnsFor(text, 'unavailable'));
      assert.ok(r.confidence >= 0.6, `got ${r.confidence}`);
    });
  }

  test('short trailing skill shift "and sql" is answerable without punctuation', () => {
    const turns = [
      { role: 'interviewer', text: 'rate your python skills out of ten', timestamp: 1000, punctuationSource: 'unavailable' },
      { role: 'user', text: 'i would say a solid eight given my daily usage over four years', timestamp: 2000, punctuationSource: 'unavailable' },
      { role: 'interviewer', text: 'and sql', timestamp: 3000, punctuationSource: 'unavailable' },
    ];
    const r = extractLatestQuestion(turns);
    assert.ok(r.confidence >= 0.6, `got ${r.confidence}`);
  });

  test('guards: interviewer statements are NOT boosted by the clause rules', () => {
    for (const text of [
      'we value ownership and autonomy',                     // "and X" but not a fragment
      'and then we moved the deployment to the new cluster', // narrative "and"
      'that is why data matters a lot to our team',          // "why" mid-narrative, long tail
    ]) {
      const r = extractLatestQuestion(turnsFor(text, 'unavailable'));
      assert.ok(r.confidence <= 0.4 + 1e-9, `"${text}" must stay low, got ${r.confidence}`);
    }
  });

  test('guards: clause rules do NOT fire when punctuation was guaranteed', () => {
    // On a punctuating provider the missing '?' and missing comma are real
    // evidence — legacy behavior stands.
    const r = extractLatestQuestion(turnsFor('just to confirm what should i call you', 'provider_final'));
    assert.ok(r.confidence <= 0.4 + 1e-9, `got ${r.confidence}`);
  });
});

describe('wait/hold idioms are not asks (negative-benchmark neg_logistics_011)', () => {
  // "Give me one second, my other monitor just died." matched the `give me`
  // imperative/interrogative lead and scored 0.8 (0.95 under unavailable
  // provenance) — the only false-question in the 15-case negative set. The
  // idiom is a pause request, not an ask.
  for (const text of [
    'Give me one second, my other monitor just died.',
    'give me a moment to pull up your resume',
    'Bear with me, the doc is loading.',
    'Give us a minute while we switch rooms.',
  ]) {
    test(`"${text}" stays below the 0.6 grounding gate`, () => {
      const r = extractLatestQuestion(turnsFor(text, 'unavailable'));
      assert.ok(r.confidence < 0.6, `got ${r.confidence}`);
    });
  }

  test('a real "give me" ask is unaffected', () => {
    const r = extractLatestQuestion(turnsFor('Give me one example of a conflict you resolved.', 'unavailable'));
    assert.ok(r.confidence >= 0.6, `got ${r.confidence}`);
  });

  test('"give me a second opinion on this system design" is still an ask (lookahead guard)', () => {
    // "a second opinion" must not be swallowed by the "give me a second" wait
    // idiom — the lookahead excludes noun continuations.
    const r = extractLatestQuestion(turnsFor('give me a second opinion on this system design', 'unavailable'));
    assert.ok(r.confidence >= 0.6, `got ${r.confidence}`);
  });
});

describe('guaranteed punctuation keeps its evidential weight (unchanged)', () => {
  test('provider_final with a lead but NO mark keeps the legacy 0.8 penalty', () => {
    const r = extractLatestQuestion(turnsFor('why did you choose Kafka for the pipeline', 'provider_final'));
    assert.ok(r.confidence <= 0.8 + 1e-9, `missing '?' on a punctuating provider stays penalized, got ${r.confidence}`);
  });
});

describe('absent provenance keeps byte-identical legacy behavior', () => {
  test('no punctuationSource field → legacy scores (0.95 mark+lead, 0.8 lead-only)', () => {
    const withMark = extractLatestQuestion(turnsFor('Why did you choose Kafka for the pipeline?', undefined));
    const noMark = extractLatestQuestion(turnsFor('why did you choose kafka for the pipeline', undefined));
    assert.equal(withMark.confidence, 0.95);
    assert.equal(noMark.confidence, 0.8);
  });

  test('non-questions stay non-questions regardless of provenance', () => {
    const r = extractLatestQuestion(turnsFor('and then we moved the deployment to the new cluster', 'unavailable'));
    assert.ok(r.confidence <= 0.3 + 1e-9, `statements must not be boosted, got ${r.confidence}`);
  });
});
