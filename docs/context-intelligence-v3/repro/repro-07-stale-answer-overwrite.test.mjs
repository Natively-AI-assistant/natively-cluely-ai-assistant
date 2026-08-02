// Phase 1 reproduction — §7.9 failure #7:
//   "Correct answer later replaced by 'not found'."
//
// NOT a regression test. These assertions describe the DESIRED post-fix
// behaviour and therefore FAIL against the current codebase. Each failure is
// the reproduced defect. See ./README.md.
//
// Root cause (investigation report §4): stream supersession identity is
// OPTIONAL on the wire. Every early-return path in _geminiChatStreamHandler
// (identity hit, clarification, safety answer, and ALL error paths) emits
// gemini-stream-token / -done / -error WITHOUT a streamId, and both guard
// reducers accept untagged events unconditionally ("back-compat" clause).
//
// Consequence: the un-supersedable emitters are exactly the refusal and
// clarification branches — which is why the observed symptom is specifically
// a correct answer being replaced by a refusal or a clarification request.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveChatStreamToken,
  resolveChatStreamDone,
  resolveLiveAnswerBatch,
} from '../../../src/lib/chatStreamGuard.mjs';

// ── Scenario ──────────────────────────────────────────────────────────────
// 1. User asks question A          → main assigns streamId 1
// 2. User supersedes with B        → main assigns streamId 2, renderer adopts 2
// 3. Request A's provider call fails / hits the safety branch / returns a
//    clarification → handler takes an EARLY-RETURN path
// 4. That path emits token+done with NO streamId  (ipcHandlers.ts:1571-1572,
//    1643-1644, 1874-1875, 4490-4491, 940-941)
// 5. Guard's back-compat clause accepts it → A's refusal overwrites B's answer.

describe('§7.9 #7 — stale answer overwrite via untagged stream events', () => {
  test('an untagged token from a superseded stream must be DROPPED', () => {
    const adopted = resolveChatStreamToken(null, 2).activeId;
    assert.equal(adopted, 2, 'precondition: renderer adopted the newer stream');

    // Stale request A resolves via an early-return path → emits no streamId.
    const stale = resolveChatStreamToken(adopted, undefined);

    assert.equal(
      stale.accept,
      false,
      'REPRO: untagged token from a superseded early-return path is accepted, ' +
        'so a stale refusal overwrites the current answer',
    );
  });

  test('an untagged done must NOT finalize a newer stream', () => {
    const adopted = resolveChatStreamToken(null, 2).activeId;

    const staleDone = resolveChatStreamDone(adopted, undefined);

    assert.equal(
      staleDone.honor,
      false,
      'REPRO: untagged done is honored, tearing down the live stream row',
    );
    assert.equal(
      staleDone.activeId,
      2,
      'REPRO: untagged done clears activeId, disarming the guard for every ' +
        'subsequent stale event',
    );
  });

  test('the live-answer (what-to-answer) batch guard has the same hole', () => {
    const adopted = resolveLiveAnswerBatch(null, 7).activeId;

    const stale = resolveLiveAnswerBatch(adopted, undefined);

    assert.equal(
      stale.accept,
      false,
      'REPRO: code-hint/brainstorm emit id-less live tokens (documented in ' +
        'chatStreamGuard.mjs) which merge into a newer answer bubble',
    );
  });

  test('gemini-stream-error carries no identity channel at all', () => {
    // preload.ts:623 —
    //   onGeminiStreamError: (cb: (error: string) => void) => () => void
    // There is no meta parameter, so no error can ever be attributed to a
    // stream, and no renderer can filter a stale one. Encoded as an explicit
    // contract assertion so the fix must change the wire signature.
    const errorEventCarriesStreamId = false; // preload.ts:623, ipcHandlers.ts:1048/1063/1070

    assert.equal(
      errorEventCarriesStreamId,
      true,
      'REPRO: gemini-stream-error has no streamId on the wire ' +
        '(preload.ts:623), so a stale error always clears the current answer',
    );
  });
});

// ── Guard behaviour that is already CORRECT (control assertions) ──────────
// These pass today. They are included so a future fix cannot regress the
// working half while closing the untagged hole.

describe('§7.9 #7 — control: tagged supersession already works', () => {
  test('a tagged older token is dropped', () => {
    assert.equal(resolveChatStreamToken(2, 1).accept, false);
  });

  test('a tagged newer token is adopted', () => {
    const r = resolveChatStreamToken(1, 2);
    assert.equal(r.accept, true);
    assert.equal(r.activeId, 2);
  });

  test('a tagged older done is ignored', () => {
    assert.equal(resolveChatStreamDone(2, 1).honor, false);
  });
});
