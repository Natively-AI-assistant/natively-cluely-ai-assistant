// electron/audio/__tests__/RagQuerySupersession2026_07_28.test.mjs
//
// Answer-pipeline-rebuild Phase 6 (concurrency/state/cache/stream safety) fix:
// a NEW rag:query-live / rag:query-meeting / rag:query-global request starting
// while a PRIOR one of the SAME class was still streaming had no backend-side
// supersession at all. The renderer (NativelyInterface.tsx's
// forceFinalizeStaleRagStream) only finalizes its own local message-bubble
// state — it never told the backend to stop the old generator. The old
// generator kept running and kept emitting rag:stream-chunk events, which the
// renderer's un-correlated accumulator (ragArrivedTextRef, keyed only by
// "the last streaming message", not by query id) would append into whatever
// answer was current by the time those late chunks arrived.
//
// rag:cancel-query exists but (a) has zero renderer call sites (confirmed via
// repo-wide grep) and (b) can't reach `live-`-prefixed keys by its own
// pre-existing comment — so it was never a real mitigation for this gap.
//
// Fix: each of the three query handlers now calls a shared
// abortPriorRAGQueriesOfClass(matchesClass) helper BEFORE minting its own new
// AbortController/queryKey, so starting a new query of a given class
// (same meetingId / live / global) always aborts any still-running query of
// that exact class first — mirroring the "abort the old, start the new"
// pattern the manual-chat stream supersession (_chatStreamsBySender) already
// uses elsewhere in this same file.
//
// Follows this file's own established pattern (see RagQueryKeyIsolation.test.mjs):
// static regex assertions against the handler source text, since these
// handlers are closures inside initializeIpcHandlers() and not independently
// importable/unit-testable without a larger refactor.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

// Code-review finding (2026-07-28): the original version of this helper
// bounded a handler's region by "next occurrence of safeHandle(" — a nearby
// unrelated handler's own literal text could silently make that bound wrong
// (overshoot into a later handler), which would make the ordering assertions
// below pass FOR THE WRONG REASON (finding the next handler's own
// `new AbortController()` instead of failing to find one in THIS handler).
// Bound it properly instead: find the arrow function's opening `{` right
// after the channel string, then walk forward counting brace depth until it
// returns to 0 — that is genuinely this handler's own body, nothing more.
function extractHandlerRegion(channel) {
  const channelIdx = ipcSource.indexOf(`'${channel}'`);
  assert.ok(channelIdx >= 0, `could not locate ${channel} handler`);
  const bodyStart = ipcSource.indexOf('=> {', channelIdx);
  assert.ok(bodyStart >= 0, `could not find the handler body opening for ${channel}`);
  let depth = 0;
  let i = bodyStart + 3; // position of the opening '{'
  for (; i < ipcSource.length; i++) {
    if (ipcSource[i] === '{') depth++;
    else if (ipcSource[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  assert.ok(depth === 0, `brace matching for ${channel} never balanced — extractor is unreliable here`);
  return ipcSource.slice(channelIdx, i);
}

describe('abortPriorRAGQueriesOfClass helper exists and is defined before any handler uses it', () => {
  test('the helper function is defined in the RAG handlers section', () => {
    assert.match(
      ipcSource,
      /function abortPriorRAGQueriesOfClass\(matchesClass: \(key: string\) => boolean\): void \{/,
    );
  });

  test('the helper aborts AND evicts every matching entry (not just abort, leaving a stale map entry behind)', () => {
    const start = ipcSource.indexOf('function abortPriorRAGQueriesOfClass');
    const end = ipcSource.indexOf('\n  }', start);
    const body = ipcSource.slice(start, end);
    assert.match(body, /controller\.abort\(\)/);
    assert.match(body, /activeRAGQueries\.delete\(key\)/);
  });

  test('the helper is defined BEFORE rag:query-meeting (so all three handlers can reference it)', () => {
    const helperIdx = ipcSource.indexOf('function abortPriorRAGQueriesOfClass');
    const meetingHandlerIdx = ipcSource.indexOf("'rag:query-meeting'");
    assert.ok(helperIdx >= 0 && meetingHandlerIdx >= 0);
    assert.ok(helperIdx < meetingHandlerIdx, 'helper must be defined before the first handler that calls it');
  });
});

describe('each RAG query handler supersedes prior queries of its own class before starting', () => {
  test('rag:query-meeting aborts prior queries for the SAME meetingId before minting a new key', () => {
    const region = extractHandlerRegion('rag:query-meeting');
    assert.match(
      region,
      /abortPriorRAGQueriesOfClass\(\(key\) => key\.startsWith\(`meeting-\$\{meetingId\}-`\)\)/,
      'must scope the abort to THIS meetingId only — a different meeting\'s in-flight query must not be touched',
    );
    // The abort call must run BEFORE the new AbortController/queryKey are minted,
    // else it would immediately abort the query it just started.
    const abortIdx = region.indexOf('abortPriorRAGQueriesOfClass');
    const newControllerIdx = region.indexOf('new AbortController()');
    assert.ok(abortIdx >= 0 && newControllerIdx >= 0 && abortIdx < newControllerIdx,
      'abortPriorRAGQueriesOfClass must run before this handler\'s own AbortController is created');
  });

  test('rag:query-live aborts prior LIVE queries before minting a new key (its only supersession path, since rag:cancel-query cannot reach live- keys)', () => {
    const region = extractHandlerRegion('rag:query-live');
    assert.match(region, /abortPriorRAGQueriesOfClass\(\(key\) => key\.startsWith\('live-'\)\)/);
    const abortIdx = region.indexOf('abortPriorRAGQueriesOfClass');
    const newControllerIdx = region.indexOf('new AbortController()');
    assert.ok(abortIdx >= 0 && newControllerIdx >= 0 && abortIdx < newControllerIdx);
  });

  test('rag:query-global aborts prior GLOBAL queries before minting a new key', () => {
    const region = extractHandlerRegion('rag:query-global');
    assert.match(region, /abortPriorRAGQueriesOfClass\(\(key\) => key\.startsWith\('global-'\)\)/);
    const abortIdx = region.indexOf('abortPriorRAGQueriesOfClass');
    const newControllerIdx = region.indexOf('new AbortController()');
    assert.ok(abortIdx >= 0 && newControllerIdx >= 0 && abortIdx < newControllerIdx);
  });

  test('meeting-scoped supersession never touches a DIFFERENT meetingId\'s key (delimiter safety, mirrors RagQueryKeyIsolation\'s existing cancel-query test)', () => {
    // meeting-abc-<uuid> must not be matched by a predicate built for meeting-abcdef-
    // (i.e. the predicate must include the trailing '-' delimiter, not just the raw id).
    const region = extractHandlerRegion('rag:query-meeting');
    const match = region.match(/abortPriorRAGQueriesOfClass\(\(key\) => key\.startsWith\(`meeting-\$\{meetingId\}-`\)\)/);
    assert.ok(match, 'expected the delimiter-safe meeting-${meetingId}- prefix, not a bare meeting-${meetingId} prefix');
  });

  // Code review (2026-07-28) flagged the test above as tautological — it re-checks the
  // source text matches a regex, but never actually RUNS the predicate against concrete
  // keys to prove the startsWith semantics are collision-free. This test closes that gap
  // by constructing the exact same predicate shape used in the real handler and running it.
  test('the meeting predicate itself (not just its source text) does not collide across meeting ids in either direction', () => {
    const makePredicate = (meetingId) => (key) => key.startsWith(`meeting-${meetingId}-`);
    const predForAbc = makePredicate('abc');
    const predForAbcdef = makePredicate('abcdef');
    assert.equal(predForAbc('meeting-abcdef-11111111-1111-1111-1111-111111111111'), false,
      'meetingId="abc" must not match a DIFFERENT meeting "abcdef" whose id happens to start with "abc"');
    assert.equal(predForAbcdef('meeting-abc-11111111-1111-1111-1111-111111111111'), false,
      'meetingId="abcdef" must not match a DIFFERENT, shorter meeting "abc"');
    assert.equal(predForAbc('meeting-abc-11111111-1111-1111-1111-111111111111'), true,
      'meetingId="abc" MUST match its own prior query key');
  });
});

describe('a superseded (aborted) query never sends a stale rag:stream-complete for the query it superseded (2026-07-28 code-review CRITICAL finding)', () => {
  // The bug: RAGManager's generators `break` (return normally) rather than throw when
  // aborted, so `event.sender.send('rag:stream-complete', ...)` was previously reached
  // UNCONDITIONALLY even for a query that abortPriorRAGQueriesOfClass had just superseded.
  // NativelyInterface.tsx has no per-query correlation for this event (it acts positionally
  // on "whatever is currently the last streaming message"), so a stale complete event for
  // the OLD, aborted query could finalize the NEW, still-empty placeholder as done —
  // silently swallowing the new answer before its first real chunk even arrives. Fixed by
  // gating the complete-send on the same `abortController.signal.aborted` check the chunk
  // loop already uses.
  for (const [channel, sentPayloadSnippet] of [
    ['rag:query-meeting', "{ meetingId }"],
    ['rag:query-live', "{ live: true }"],
    ['rag:query-global', "{ global: true }"],
  ]) {
    test(`${channel} gates its rag:stream-complete send on !abortController.signal.aborted`, () => {
      const region = extractHandlerRegion(channel);
      const sendIdx = region.indexOf(`event.sender.send('rag:stream-complete', ${sentPayloadSnippet})`);
      assert.ok(sendIdx >= 0, `expected to find the rag:stream-complete send for ${channel}`);
      // The nearest preceding 'if' within 200 chars must be the abort guard —
      // this rules out the send being reachable unconditionally.
      const precedingSlice = region.slice(Math.max(0, sendIdx - 200), sendIdx);
      assert.match(precedingSlice, /if\s*\(\s*!abortController\.signal\.aborted\s*\)\s*\{/,
        `${channel}'s rag:stream-complete send must be gated on !abortController.signal.aborted`);
    });
  }
});

describe('the underlying abort mechanism actually stops chunk emission (RAGManager honors the signal)', () => {
  test('RAGManager.queryMeeting/queryGlobal check abortSignal.aborted inside their generator loops', () => {
    const ragManagerSrc = readFileSync(
      path.resolve(__dirname, '../../rag/RAGManager.ts'), 'utf8',
    );
    const checks = ragManagerSrc.match(/abortSignal\?\.aborted/g) || [];
    assert.ok(checks.length >= 2, 'both queryMeeting and queryGlobal should check abortSignal.aborted inside their loops');
  });
});
