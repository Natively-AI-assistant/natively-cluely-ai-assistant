// electron/llm/__tests__/LiveSessionA2026_08_20.test.mjs
//
// Regression suite built from the FIRST live shadow session (session A,
// 2026-08-20, LocalWhisper provider, 28 What-to-Answer presses). Every string
// below is a verbatim transcript line from that run — no hand-written cases.
//
// What the session measured: 20 of 28 presses scored extractor confidence
// 0.3, which sits under the live 0.6 profile-grounding gate, so the résumé
// never reached the prompt (candidateProfileChars:0 on 23 of 28 presses;
// structured_resume_used:false on all 28). Grounding by bucket was
// conf=0.8 → 4/5 grounded, conf=0.3 → 1/20. Two root causes, both ours:
//
//   1. TASK DIRECTIVES were never taught to the LIVE extractor. "Rate your
//      SQL out of ten", "Convince me you're right for this role", "Solve two
//      sum" carry no '?', no clause-initial wh/aux lead, and no member of the
//      tell-me IMPERATIVE_ASK family, so they hit the 0.4 baseline and then
//      the answerability floor's 0.3 cap. The shadow QuestionLedger already
//      had TASK_DIRECTIVE (added from the ledger benchmark, where the same
//      gap explained 9 of 10 no-ask windows) — the capability simply never
//      crossed over to the extractor that production actually selects with.
//
//   2. LOCAL-WHISPER WAS MIS-CLASSIFIED as a punctuation-guaranteed provider.
//      Measured on this run: it emitted '.' or ',' on 15/28 turns but a '?'
//      on only 3/28 (11%). Question detection depends on question marks
//      specifically, not on punctuation in general, so stamping its turns
//      'provider_final' suppressed the clause-level recovery that exists for
//      exactly this case and told the scorer a missing '?' was real evidence
//      of not-a-question.
//
// These tests fail if either fix is reverted.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { extractLatestQuestion } = await import(dist('transcriptQuestionExtractor.js'));
const { punctuationSourceFor } = await import(dist('punctuationProvenance.js'));

/** A realistic 3-turn window ending on the interviewer line under test. */
const windowFor = (text, punctuationSource) => ([
  { role: 'interviewer', text: 'Let me give you a little context on how the team is set up.', timestamp: 1000, punctuationSource },
  { role: 'user', text: 'That makes sense to me, thanks for walking me through all of that.', timestamp: 2000, punctuationSource },
  { role: 'interviewer', text, timestamp: 3000, punctuationSource },
]);

const GROUNDING_GATE = 0.6;

describe('session A: local-whisper is NOT a question-mark-guaranteed provider', () => {
  test("local-whisper stamps 'unavailable' so a missing '?' stays neutral", () => {
    assert.equal(punctuationSourceFor('local-whisper', true), 'unavailable');
    assert.equal(punctuationSourceFor('local-whisper', false), 'unavailable');
  });

  test('providers that explicitly request smart punctuation are unchanged', () => {
    assert.equal(punctuationSourceFor('deepgram', true), 'provider_final');
    assert.equal(punctuationSourceFor('deepgram', false), 'provider_interim');
    assert.equal(punctuationSourceFor('google', true), 'provider_final');
  });

  test('unknown providers still fail safe to unavailable', () => {
    assert.equal(punctuationSourceFor('some-future-provider', true), 'unavailable');
    assert.equal(punctuationSourceFor(undefined, true), 'unavailable');
  });
});

describe('session A: task directives must clear the profile-grounding gate', () => {
  // Verbatim interviewer lines that scored 0.3 live and lost the résumé.
  for (const text of [
    'Rate your SQL out of ten honestly',
    "Convince me you're right for this role",
    "Let's do a quick technical exercise nothing scary. Solve two sum. Just talk me through your approach",
    'Write a SQL query for the second highest salary',
    'Implement binary search and talk me through the complexity',
  ]) {
    test(`"${text.slice(0, 48)}…" clears ${GROUNDING_GATE}`, () => {
      const r = extractLatestQuestion(windowFor(text, 'provider_final'));
      assert.ok(r.confidence >= GROUNDING_GATE, `got ${r.confidence}`);
    });
  }

  test('task directives are recognised regardless of punctuation provenance', () => {
    for (const ps of ['provider_final', 'provider_interim', 'unavailable', undefined]) {
      const r = extractLatestQuestion(windowFor('Rate your SQL out of ten honestly', ps));
      assert.ok(r.confidence >= GROUNDING_GATE, `provenance ${ps}: got ${r.confidence}`);
    }
  });
});

describe('session A: unpunctuated clause interrogatives (now reachable on local-whisper)', () => {
  for (const text of [
    'And if we need production SQL from you on day one, real queries against a messy warehouse how ready are you',
    'Actually, hold on more basic question first What database is under it',
    'How comfortable are you with pandas and the analysis side of Python',
  ]) {
    test(`"${text.slice(0, 48)}…" clears ${GROUNDING_GATE} under local-whisper`, () => {
      const ps = punctuationSourceFor('local-whisper', true);
      const r = extractLatestQuestion(windowFor(text, ps));
      assert.ok(r.confidence >= GROUNDING_GATE, `got ${r.confidence}`);
    });
  }
});

describe('session A: guards — the noise from this run must STAY below the gates', () => {
  // Every one of these was also spoken in session A and must not become an ask.
  const SPECULATIVE_GATE = 0.75;
  for (const text of [
    'Okay, that makes sense',
    'Interesting by the way that redismart caching number sounds pretty solid',
    'Give me one second, my other monitor just died',
    'We value ownership and autonomy a lot here',
    'The analysts own the dashboards end to end, ETL through presentation',
  ]) {
    test(`"${text.slice(0, 48)}…" stays under ${GROUNDING_GATE}`, () => {
      const ps = punctuationSourceFor('local-whisper', true);
      const r = extractLatestQuestion(windowFor(text, ps));
      assert.ok(r.confidence < GROUNDING_GATE, `got ${r.confidence}`);
    });
  }

  test('the pleasantry that scored 0.95 live must not clear the speculative gate', () => {
    // Live defect: classified follow_up (isFollowUp short-circuits questionType),
    // and the SOCIAL_PLEASANTRY cap only applied to questionType 'general', so
    // small talk cleared BOTH gates and could fire an unsolicited suggestion.
    const ps = punctuationSourceFor('local-whisper', true);
    const r = extractLatestQuestion(windowFor("How's your day going so far? I know it's evening over in Kochi", ps));
    assert.ok(r.confidence < SPECULATIVE_GATE, `pleasantry scored ${r.confidence} (type ${r.questionType})`);
  });

  test('declarative statements containing a directive verb are not asks', () => {
    const ps = punctuationSourceFor('local-whisper', true);
    for (const text of [
      'We design for scale and we build everything in house',
      'Our team solves these problems together every single day',
    ]) {
      const r = extractLatestQuestion(windowFor(text, ps));
      assert.ok(r.confidence < GROUNDING_GATE, `"${text}" got ${r.confidence}`);
    }
  });
});
