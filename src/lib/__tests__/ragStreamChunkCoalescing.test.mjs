// Regression test: onRAGStreamChunk must coalesce chunks via rAF instead of
// calling setMessages() (full array clone + re-render) on every chunk.
//
// THE BUG THIS PINS: NativelyInterface.tsx's onRAGStreamChunk handler called
// setMessages() directly per chunk. RAG chunks stream from the SAME
// async-generator-over-SSE mechanism as onGeminiStreamToken (ipcHandlers.ts
// `for await (const chunk of stream) event.sender.send('rag:stream-chunk', ...)`),
// which was ALREADY fixed for exactly this per-token setMessages cost via rAF
// coalescing (see the "PERF: streaming-token rAF coalescing" block a few
// hundred lines above in the same file). onRAGStreamChunk was the one sibling
// stream handler still doing the expensive thing: for a long meeting-recall
// answer this meant one full messages-array clone + re-render per chunk.
//
// THE FIX: chunks accumulate in a ref (ragChunkBufRef) and flush to state at
// most once per animation frame (ragChunkRafRef), matching the pattern already
// proven via useStreamBuffer in MeetingChatOverlay.tsx. onRAGStreamComplete /
// onRAGStreamError flush any pending buffered text BEFORE finalizing (so the
// last frame's chunk is never dropped), and the effect's cleanup cancels any
// pending RAF + drops the buffer on unmount/teardown.
//
// This is a source-structural test (the logic lives inline in a large
// component effect, not extracted to a testable pure module) — it pins the
// invariants a regression could silently break: buffering, RAF scheduling,
// flush-before-finalize, and cleanup.

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

test('ragChunkBufRef / ragChunkRafRef refs are declared', () => {
  assert.match(source, /const ragChunkBufRef = useRef<string>\(''\)/);
  assert.match(source, /const ragChunkRafRef = useRef<number \| null>\(null\)/);
});

test('onRAGStreamChunk buffers into the ref instead of calling setMessages directly', () => {
  const chunkHandlerStart = source.indexOf('window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {');
  assert.ok(chunkHandlerStart >= 0, 'onRAGStreamChunk handler must exist');
  // Slice a bounded window after the handler start and confirm it buffers +
  // schedules RAF, and does NOT call setMessages synchronously in that body.
  const window_ = source.slice(chunkHandlerStart, chunkHandlerStart + 400);
  assert.match(window_, /ragChunkBufRef\.current \+= data\.chunk/, 'must accumulate the chunk in the ref buffer');
  assert.match(window_, /if \(ragChunkRafRef\.current === null\)/, 'must only schedule one RAF per frame');
  assert.match(window_, /requestAnimationFrame\(\(\) => \{/, 'must schedule the flush via requestAnimationFrame');
  assert.doesNotMatch(window_, /setMessages\(/, 'the chunk handler body itself must not call setMessages synchronously');
});

test('flushRagChunkBuffer performs the actual setMessages commit with isCode detection', () => {
  const fnStart = source.indexOf('const flushRagChunkBuffer = () => {');
  assert.ok(fnStart >= 0, 'flushRagChunkBuffer must exist');
  const body = source.slice(fnStart, fnStart + 700);
  assert.match(body, /cancelRagChunkRaf\(\)/, 'flush must cancel any pending RAF (avoid double-flush)');
  assert.match(body, /setMessages\(\(prev\) => \{/, 'flush is the only place that commits to React state');
  assert.match(body, /isCode: text\.includes\('```'\)/, 'must preserve the original isCode-detection behavior');
});

test('onRAGStreamComplete and onRAGStreamError flush the buffer before finalizing', () => {
  const completeStart = source.indexOf("window.electronAPI.onRAGStreamComplete(() => {");
  const errorStart = source.indexOf("window.electronAPI.onRAGStreamError((data: { error: string }) => {");
  assert.ok(completeStart >= 0 && errorStart >= 0);
  const completeBody = source.slice(completeStart, completeStart + 400);
  const errorBody = source.slice(errorStart, errorStart + 250);
  assert.match(completeBody, /flushRagChunkBuffer\(\)/, 'stream-complete must flush any buffered trailing chunk first');
  assert.match(errorBody, /flushRagChunkBuffer\(\)/, 'stream-error must flush any buffered trailing chunk first');
});

test('the effect cleanup cancels the RAF and clears the buffer', () => {
  const cleanupComment = source.indexOf('// Cleanup: cancel any pending RAF and drop buffered');
  assert.ok(cleanupComment >= 0, 'a dedicated cleanup entry for the RAG chunk buffer must exist');
  const body = source.slice(cleanupComment, cleanupComment + 250);
  assert.match(body, /cancelRagChunkRaf\(\)/);
  assert.match(body, /ragChunkBufRef\.current = ''/);
});
