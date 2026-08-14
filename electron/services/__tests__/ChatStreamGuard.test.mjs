// electron/services/__tests__/ChatStreamGuard.test.mjs
//
// HIGH (audit finding #3) — renderer-side stale-token rejection. The main process
// emits chat tokens on ONE `gemini-stream-token` channel from both the desktop and
// phone-mirror chat paths; the renderer keys streams only on intent ('chat'), so a
// superseded stream could bleed tokens into the active bubble. The wire now carries
// an optional numeric streamId and the renderer drops tokens/done from an older
// stream. This tests the pure reducer that drives that decision.
//
// Pure helper — runs under plain `node --test` (no compiled deps).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../src/lib/chatStreamGuard.mjs');
const { resolveChatStreamToken, resolveChatStreamDone, resolveLiveAnswerBatch } = await import(pathToFileURL(modPath).href);

describe('resolveChatStreamToken', () => {
  test('no incoming id → accept, active id unchanged (backward compat)', () => {
    assert.deepEqual(resolveChatStreamToken(null, undefined), { accept: true, activeId: null });
    assert.deepEqual(resolveChatStreamToken(7, undefined), { accept: true, activeId: 7 });
  });

  test('first token with an id is adopted', () => {
    assert.deepEqual(resolveChatStreamToken(null, 3), { accept: true, activeId: 3 });
  });

  test('same id → accept, unchanged', () => {
    assert.deepEqual(resolveChatStreamToken(3, 3), { accept: true, activeId: 3 });
  });

  test('newer id supersedes (accept + adopt)', () => {
    assert.deepEqual(resolveChatStreamToken(3, 5), { accept: true, activeId: 5 });
  });

  test('older id is DROPPED (stale stream still trickling)', () => {
    assert.deepEqual(resolveChatStreamToken(5, 3), { accept: false, activeId: 5 });
  });

  test('interleave: desktop(5) active, late phone(4) token dropped, then desktop(5) continues', () => {
    let active = null;
    // desktop stream 5 first token
    let d = resolveChatStreamToken(active, 5); active = d.activeId;
    assert.equal(d.accept, true);
    // stale phone stream 4 token arrives late → dropped, active stays 5
    d = resolveChatStreamToken(active, 4); active = d.activeId;
    assert.equal(d.accept, false);
    assert.equal(active, 5);
    // desktop 5 continues
    d = resolveChatStreamToken(active, 5);
    assert.equal(d.accept, true);
  });

  test('a genuinely newer stream takes over mid-flight', () => {
    let active = 5;
    const d = resolveChatStreamToken(active, 9);
    assert.deepEqual(d, { accept: true, activeId: 9 });
  });
});

describe('resolveChatStreamDone', () => {
  test('no id → honor + clear (backward compat)', () => {
    assert.deepEqual(resolveChatStreamDone(5, undefined), { honor: true, activeId: null });
    assert.deepEqual(resolveChatStreamDone(null, undefined), { honor: true, activeId: null });
  });

  test('done for the active stream → honor + clear', () => {
    assert.deepEqual(resolveChatStreamDone(5, 5), { honor: true, activeId: null });
  });

  test('done for a NEWER stream → honor + clear', () => {
    assert.deepEqual(resolveChatStreamDone(5, 7), { honor: true, activeId: null });
  });

  test('stale done (older stream) is IGNORED, active id preserved', () => {
    assert.deepEqual(resolveChatStreamDone(5, 3), { honor: false, activeId: 5 });
  });

  test('done with no active id yet → honor (lets a fast-path no-id answer finalize)', () => {
    assert.deepEqual(resolveChatStreamDone(null, 5), { honor: true, activeId: null });
  });
});

// Audit finding #3 (FULL) — the LIVE answer (what-to-answer) token-batch path was
// keyed only on intent ('what_to_answer'), so a superseded answer's already-queued
// batch could merge into the new same-intent bubble. resolveLiveAnswerBatch is the
// renderer-side guard (same "newest wins" policy, generationId on the wire).
describe('resolveLiveAnswerBatch (live answer generation supersession)', () => {
  test('id-less items accepted, active id unchanged (code-hint/brainstorm/older builds)', () => {
    assert.deepEqual(resolveLiveAnswerBatch(null, undefined), { accept: true, activeId: null });
    assert.deepEqual(resolveLiveAnswerBatch(11, undefined), { accept: true, activeId: 11 });
  });

  test('first numeric generation id is adopted', () => {
    assert.deepEqual(resolveLiveAnswerBatch(null, 10), { accept: true, activeId: 10 });
  });

  test('same / newer / older generation policy', () => {
    assert.deepEqual(resolveLiveAnswerBatch(10, 10), { accept: true, activeId: 10 });
    assert.deepEqual(resolveLiveAnswerBatch(10, 11), { accept: true, activeId: 11 });
    assert.deepEqual(resolveLiveAnswerBatch(11, 10), { accept: false, activeId: 11 });
  });

  test('a stale gen straggler after a newer answer started is dropped', () => {
    let active = null;
    const accepted = [];
    for (const id of [10, 10, 11, 10 /* straggler */, 11]) {
      const d = resolveLiveAnswerBatch(active, id);
      active = d.activeId;
      accepted.push(d.accept);
    }
    assert.deepEqual(accepted, [true, true, true, false, true]);
    assert.equal(active, 11);
  });
});
