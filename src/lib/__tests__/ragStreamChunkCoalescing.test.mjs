// Regression test: onRAGStreamChunk must coalesce chunks via rAF instead of
// calling setMessages() (full array clone + re-render) on every chunk, AND
// must PACE how much of the accumulated backlog it reveals per frame — via
// the same deterministic, rate-capped reveal model as the main streaming
// path (src/lib/textRevealPacing.mjs) — rather than committing the whole
// backlog to state in one shot.
//
// THE ORIGINAL BUG THIS PINS: NativelyInterface.tsx's onRAGStreamChunk
// handler called setMessages() directly per chunk. RAG chunks stream from
// the SAME async-generator-over-SSE mechanism as onGeminiStreamToken
// (ipcHandlers.ts `for await (const chunk of stream) event.sender.send('rag:
// stream-chunk', ...)`), which was already fixed for exactly this per-token
// setMessages cost via rAF coalescing (see the "PERF: streaming-token rAF
// coalescing" block a few hundred lines above in the same file).
//
// THE SECOND BUG THIS PINS (smooth-reveal follow-up): the original rAF fix
// still committed the ENTIRE buffered backlog to state on the very next
// frame — if several chunks land in the same event-loop tick (normal under
// load), the whole burst appears in the bubble at once ("dumping tokens").
//
// THE THIRD SHAPE (deterministic-streaming rewrite): ragArrivedTextRef now
// accumulates the FULL arrived text (never truncated, mirroring
// streamingTextRef in the main path) and ragPacerRef is a cursor into it —
// NOT a shrinking queue that slices its revealed prefix off the front. A
// shrinking queue doesn't carry per-stream pacer state (initial-buffer
// timestamp, fractional rate budget, punctuation-hold deadline) cleanly, and
// a boundary holdback returning zero progress against a buffer that never
// grows again before the stream ends would stall it permanently. The
// cursor-over-accumulated-text shape has no such failure mode.
//
// THE FOURTH SHAPE (deterministic character-based streaming, v2 —
// "Deterministic Character-Based Streaming" spec): per
// STREAM_RENDER_CONFIG.flushImmediatelyOnComplete (default false), the
// provider finishing does NOT snap the remaining backlog to full text
// anymore. onRAGStreamComplete marks ragDoneRef instead of force-flushing,
// and ragRevealTick's own catch-up branch performs the actual
// isStreaming:false commit once the reveal has genuinely caught up — so the
// animation drains at the same deterministic rate all the way to the final
// character regardless of when the network finished. Errors are the one
// exception that stays instant (never deferred). Because RAG has no
// explicit per-message id (it operates positionally on "the last
// isStreaming system message"), a NEW RAG query starting while a PREVIOUS
// one is still deferred-draining would otherwise collide — both racing to
// own the same position. forceFinalizeStaleRagStream, called immediately
// before both ragQueryLive call sites, closes that gap by force-finalizing
// whatever stale stream was left mid-drain first.
//
// This is a source-structural test (the logic lives inline in a large
// component effect, not extracted to a testable pure module) — it pins the
// invariants a regression could silently break: buffering, paced (not
// all-at-once) reveal via the shared pacer, deferred-vs-instant completion,
// the RAG-collision guard, and cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/NativelyInterface.tsx'),
  'utf8',
);

test('ragArrivedTextRef / ragPacerRef / ragChunkRafRef refs are declared', () => {
  assert.match(source, /const ragArrivedTextRef = useRef<string>\(''\)/);
  assert.match(source, /const ragPacerRef = useRef\(createPacerState\(\)\)/);
  assert.match(source, /const ragChunkRafRef = useRef<number \| null>\(null\)/);
});

test('onRAGStreamChunk accumulates the FULL arrived text and defers to the paced ticker instead of calling setMessages directly', () => {
  const chunkHandlerStart = source.indexOf('window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {');
  assert.ok(chunkHandlerStart >= 0, 'onRAGStreamChunk handler must exist');
  const body = source.slice(chunkHandlerStart, chunkHandlerStart + 250);
  assert.match(body, /ragArrivedTextRef\.current \+= data\.chunk/, 'must accumulate the chunk into the never-truncated arrived-text ref');
  assert.match(body, /ensureRagRevealTicker\(\)/, 'must hand off to the paced reveal ticker, not schedule its own ad-hoc RAF');
  assert.doesNotMatch(body, /setMessages\(/, 'the chunk handler body itself must not call setMessages synchronously');
});

test('ragRevealTick paces the reveal via the shared tickPacer state machine, as a cursor over accumulated text', () => {
  const fnStart = source.indexOf('const ragRevealTick = (ts: number) => {');
  assert.ok(fnStart >= 0, 'ragRevealTick must exist and take the rAF timestamp');
  const body = source.slice(fnStart, fnStart + 900);
  assert.match(body, /tickPacer\(pacer, fullText, ts, deltaMs, \{ reducedMotion: prefersReducedMotionRef\.current \}\)/, 'must pace via the shared deterministic tickPacer, not a bespoke fraction-of-backlog formula');
  assert.match(body, /commitRagText\(fullText\.slice\(0, pacer\.revealedLen\)\)/, 'must commit the revealed PREFIX of the accumulated text (cursor shape), not an appended delta off a shrinking buffer');
  assert.match(body, /if \(pacer\.revealedLen < fullText\.length\) \{/, 'must only reschedule while backlog remains (self-terminate once caught up)');
  assert.doesNotMatch(body, /ragChunkBufRef/, 'must not reference the old shrinking-queue buffer');
});

test('commitRagText sets the full revealed prefix (not an append) and preserves isCode detection', () => {
  const fnStart = source.indexOf('const commitRagText = (revealedText: string) => {');
  assert.ok(fnStart >= 0, 'commitRagText must exist, taking the full revealed-so-far text');
  const body = source.slice(fnStart, fnStart + 500);
  assert.match(body, /setMessages\(\(prev\) => \{/, 'commitRagText is the only place that commits to React state');
  assert.match(body, /text: revealedText, isCode: revealedText\.includes\('```'\)/, 'must set text to the revealed prefix directly and preserve isCode detection');
});

test('flushRagChunkBuffer cancels the RAF, commits the FULL remaining backlog instantly (no pacing at stream end), and resets pacer state for the next answer', () => {
  const fnStart = source.indexOf('const flushRagChunkBuffer = () => {');
  assert.ok(fnStart >= 0, 'flushRagChunkBuffer must exist');
  const body = source.slice(fnStart, fnStart + 500);
  assert.match(body, /cancelRagChunkRaf\(\)/, 'flush must cancel any pending RAF (avoid a stray paced tick after finalize)');
  assert.match(body, /commitRagText\(fullText\)/, 'flush must commit the FULL arrived text, bypassing pacing');
  assert.match(body, /ragArrivedTextRef\.current = ''/, 'must reset the accumulator so the next RAG answer starts fresh');
  assert.match(body, /ragPacerRef\.current = createPacerState\(\)/, 'must reset the pacer so the next RAG answer gets its own initial-buffer window, not stale state from this one');
  assert.doesNotMatch(body, /tickPacer/, 'flush must NOT pace — any queued-but-unrevealed text must appear instantly when the stream ends');
});

test('onRAGStreamComplete honors flushImmediatelyOnComplete: instant flush when true, deferred-to-catch-up when false (default)', () => {
  const completeStart = source.indexOf("window.electronAPI.onRAGStreamComplete(() => {");
  assert.ok(completeStart >= 0, 'onRAGStreamComplete handler must exist');
  const body = source.slice(completeStart, completeStart + 2000);
  assert.match(body, /if \(STREAM_RENDER_CONFIG\.flushImmediatelyOnComplete\) \{/, 'must branch on the config flag rather than always flushing instantly');
  assert.match(body, /flushRagChunkBuffer\(\)/, 'the flushImmediatelyOnComplete=true branch must still flush instantly (config escape hatch preserved)');
  assert.match(body, /ragDoneRef\.current = true/, 'the default (deferred) branch must mark done rather than force-finalize immediately');
  assert.match(body, /ensureRagRevealTicker\(\)/, 'the deferred branch must wake the ticker in case it had already self-terminated, or the row would never finalize');
});

test('ragRevealTick only commits isStreaming:false once BOTH caught up AND ragDoneRef is set — the deferred-completion catch-up branch', () => {
  const fnStart = source.indexOf('const ragRevealTick = (ts: number) => {');
  assert.ok(fnStart >= 0);
  const body = source.slice(fnStart, fnStart + 1800);
  assert.match(body, /if \(ragDoneRef\.current\) \{/, 'the catch-up branch must gate the actual finalize commit on ragDoneRef');
  assert.match(body, /isStreaming: false/, 'must still perform the isStreaming:false commit somewhere in the catch-up path');
});

test('onRAGStreamError stays instant (never deferred) and resets ragDoneRef so a still-running ticker cannot overwrite the appended error text', () => {
  const errorStart = source.indexOf("window.electronAPI.onRAGStreamError((data: { error: string }) => {");
  assert.ok(errorStart >= 0);
  const errorBody = source.slice(errorStart, errorStart + 400);
  assert.match(errorBody, /flushRagChunkBuffer\(\)/, 'stream-error must flush (and reset ragDoneRef) instantly, never deferred');
  const flushFnStart = source.indexOf('const flushRagChunkBuffer = () => {');
  assert.ok(flushFnStart >= 0);
  const flushBody = source.slice(flushFnStart, flushFnStart + 400);
  assert.match(flushBody, /ragDoneRef\.current = false/, 'flushRagChunkBuffer must reset ragDoneRef so the NEXT RAG answer never inherits a stale done flag');
});

test('forceFinalizeStaleRagStream exists and is called before both ragQueryLive invocations, so a new RAG query never collides with a previous one still deferred-draining', () => {
  const fnStart = source.indexOf('const forceFinalizeStaleRagStream = useCallback(() => {');
  assert.ok(fnStart >= 0, 'forceFinalizeStaleRagStream must exist');
  const body = source.slice(fnStart, fnStart + 900);
  assert.match(body, /isStreaming: false/, 'must instantly finalize whatever stale RAG row was left mid-drain');
  assert.match(body, /ragDoneRef\.current = false/, 'must reset ragDoneRef for the upcoming new stream');

  const callSites = [...source.matchAll(/forceFinalizeStaleRagStream\(\);/g)];
  assert.ok(callSites.length >= 2, `expected at least 2 call sites (one per ragQueryLive invocation), found ${callSites.length}`);
});

test('the effect cleanup cancels the RAF and clears the accumulated text', () => {
  const cleanupComment = source.indexOf('// Cleanup: cancel any pending RAF and drop buffered');
  assert.ok(cleanupComment >= 0, 'a dedicated cleanup entry for the RAG accumulator must exist');
  const body = source.slice(cleanupComment, cleanupComment + 250);
  assert.match(body, /cancelRagChunkRaf\(\)/);
  assert.match(body, /ragArrivedTextRef\.current = ''/);
});
