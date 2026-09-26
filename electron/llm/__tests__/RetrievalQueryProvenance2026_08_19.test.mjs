// electron/llm/__tests__/RetrievalQueryProvenance2026_08_19.test.mjs
//
// HDFC leak regression (2026-08-18, session_31d52d42): a WTA press with no
// captured speech, no screenshot, and no page text fell back to
// `retrievalQuery = cleanedTranscript`, whose ONLY content was the assistant's
// own previous answer. That self-echo query ran pool-relative retrieval over
// the active mode's reference files and admitted an unrelated private bank
// document, which then became the turn's only substantive evidence.
//
// The fix is the pure provenance policy in retrievalQueryPolicy.ts, wired at:
//   1. WhatToAnswerLLM.generateStream — inline retrieval gate + every
//      retrievalQuery/okfQuery site + the governed EvidenceResolver question
//   2. IntelligenceEngine's parallel mode-context prefetch
//   3. ModesManager.buildRetrievedActiveModeContextBlock{,Hybrid} +
//      retrieveHybridRaw — fail-closed on an empty query at the choke point
//
// These tests pin the pure rule; the choke-point guards are one-line
// early-returns covered by typecheck + the rule tests here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { deriveRetrievalQuery, stripAssistantTurns, SCREEN_TEXT_QUERY_MAX_CHARS } = await import(
  pathToFileURL(path.join(base, 'llm/retrievalQueryPolicy.js')).href
);

// The exact shape of the leaking turn: transcript window holds ONLY the
// assistant's previous answer (multi-line markdown), nothing else.
const ASSISTANT_ONLY_WINDOW = [
  '[ASSISTANT]: ## Approach',
  '- Use two pointers starting at both ends of the array.',
  '```cpp',
  'int trap(vector<int>& height) { /* ... */ }',
  '```',
].join('\n');

describe('deriveRetrievalQuery — the HDFC invariant', () => {
  test('blind turn (assistant-echo transcript, no question, no screen text) → retrieval DISALLOWED', () => {
    const d = deriveRetrievalQuery({
      extractedQuestion: '',
      transcriptWindow: ASSISTANT_ONLY_WINDOW,
      capturedScreenText: '',
    });
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'none');
    assert.equal(d.query, '');
  });

  test('fully empty turn → retrieval DISALLOWED', () => {
    const d = deriveRetrievalQuery({});
    assert.equal(d.allowed, false);
    assert.equal(d.source, 'none');
  });

  test('extracted question wins and is used verbatim', () => {
    const d = deriveRetrievalQuery({
      extractedQuestion: '  What is the time complexity?  ',
      transcriptWindow: ASSISTANT_ONLY_WINDOW,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.source, 'question');
    assert.equal(d.query, 'What is the time complexity?');
  });

  test('no question but spoken lines present → query is the NON-assistant transcript only', () => {
    const window = [
      '[INTERVIEWER]: Can you optimize the space usage?',
      ASSISTANT_ONLY_WINDOW,
      '[ME]: Sure, let me think about two pointers.',
    ].join('\n');
    const d = deriveRetrievalQuery({ transcriptWindow: window });
    assert.equal(d.allowed, true);
    assert.equal(d.source, 'user_transcript');
    assert.ok(d.query.includes('Can you optimize the space usage?'));
    assert.ok(d.query.includes('two pointers'));
    assert.ok(!d.query.includes('## Approach'), 'assistant turn must not leak into the query');
    assert.ok(!d.query.includes('int trap'), 'assistant code must not leak into the query');
  });

  test('no question, no speech, but captured screen text → query keyed on the screen (capped)', () => {
    const d = deriveRetrievalQuery({
      transcriptWindow: ASSISTANT_ONLY_WINDOW,
      capturedScreenText: 'Trapping Rain Water — LeetCode. '.repeat(200),
    });
    assert.equal(d.allowed, true);
    assert.equal(d.source, 'screen_text');
    assert.ok(d.query.startsWith('Trapping Rain Water'));
    assert.ok(d.query.length <= SCREEN_TEXT_QUERY_MAX_CHARS);
  });

  test('whitespace-only signals count as absent', () => {
    const d = deriveRetrievalQuery({
      extractedQuestion: '   ',
      transcriptWindow: '[ASSISTANT]: prior answer',
      capturedScreenText: '\n\n  ',
    });
    assert.equal(d.allowed, false);
  });
});

describe('stripAssistantTurns — label-delimited, not line-delimited', () => {
  test('assistant continuation lines (unlabelled markdown/code) are dropped with their turn', () => {
    const out = stripAssistantTurns(ASSISTANT_ONLY_WINDOW);
    assert.equal(out, '');
  });

  test('interviewer and candidate turns survive, order preserved', () => {
    const out = stripAssistantTurns([
      '[INTERVIEWER]: First question?',
      '[ASSISTANT]: an answer',
      'with a continuation line',
      '[ME]: my reply',
    ].join('\n'));
    assert.equal(out, '[INTERVIEWER]: First question?\n[ME]: my reply');
  });

  test('a later non-assistant label ends the drop', () => {
    const out = stripAssistantTurns([
      '[ASSISTANT]: stale',
      '[INTERVIEWER]: real question',
      'spanning two lines',
    ].join('\n'));
    assert.equal(out, '[INTERVIEWER]: real question\nspanning two lines');
  });

  test('unlabelled leading text is provenance-unknown and kept (never attributed to the assistant)', () => {
    const out = stripAssistantTurns('context preamble\n[ASSISTANT]: stale');
    assert.equal(out, 'context preamble');
  });
});
