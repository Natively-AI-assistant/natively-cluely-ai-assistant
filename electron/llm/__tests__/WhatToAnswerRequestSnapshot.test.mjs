// electron/llm/__tests__/WhatToAnswerRequestSnapshot.test.mjs
//
// Audit findings #6 + #3 + #9 — behavioral coverage for the request-scoped
// snapshot minted once at the start of runWhatShouldISay and threaded through the
// pipeline so a mid-request `modes:set-active` can't split one answer across two
// modes (and so live tokens carry a supersession id + the trace can be joined).
//
// The compiled module has NO runtime dependencies (it imports only a TYPE), so it
// runs under plain `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/whatToAnswerRequestSnapshot.js',
);
const { buildWhatToAnswerRequestSnapshot, resolveLiveAnswerBatch } =
  await import(pathToFileURL(modPath).href);

describe('buildWhatToAnswerRequestSnapshot (#6 — capture mode ONCE at t0)', () => {
  const liveMode = {
    id: 'mode_abc',
    templateType: 'technical-interview',
    name: 'My TI Mode',
    isCustom: false,
  };
  const reader = {
    getActiveModeInfo: () => liveMode,
    getActiveMode: () => ({ templateType: 'technical-interview' }),
  };

  test('captures the active mode info, template id, and unique id', () => {
    const snap = buildWhatToAnswerRequestSnapshot({
      modeReader: reader,
      requestId: 'pi_1_1',
      generationId: 7,
      sessionId: 'sess-1',
      meetingId: 'sess-1',
    });
    assert.deepEqual(snap.activeModeInfo, liveMode);
    assert.equal(snap.modeId, 'technical-interview');
    assert.equal(snap.modeUniqueId, 'mode_abc');
    assert.equal(snap.requestId, 'pi_1_1');
    assert.equal(snap.sessionId, 'sess-1');
    assert.equal(snap.meetingId, 'sess-1');
    assert.equal(snap.surface, 'what_to_answer');
    assert.equal(snap.generationId, 7);
  });

  test('the snapshot is frozen (immutable) — mid-request mode flips cannot mutate it', () => {
    const snap = buildWhatToAnswerRequestSnapshot({
      modeReader: reader, requestId: 'r', generationId: 1,
    });
    assert.ok(Object.isFrozen(snap), 'snapshot must be frozen');
    // Attempting to mutate throws in strict mode (this file is an ES module).
    assert.throws(() => { snap.modeId = 'sales'; });
    assert.equal(snap.modeId, 'technical-interview', 'value unchanged after mutation attempt');
  });

  test('a subsequent live mode switch does NOT change an already-built snapshot', () => {
    // Build the snapshot, THEN flip what the live reader returns. The snapshot
    // must still reflect the t0 read — proving downstream stages that read the
    // snapshot see one consistent mode even across an await boundary.
    let current = liveMode;
    const mutableReader = {
      getActiveModeInfo: () => current,
      getActiveMode: () => ({ templateType: current.templateType }),
    };
    const snap = buildWhatToAnswerRequestSnapshot({
      modeReader: mutableReader, requestId: 'r', generationId: 1,
    });
    // modes:set-active fires mid-request → live reader now returns sales mode.
    current = { id: 'mode_sales', templateType: 'general', name: 'Sales', isCustom: true };
    assert.equal(snap.modeId, 'technical-interview');
    assert.equal(snap.modeUniqueId, 'mode_abc');
    // A fresh live read would now disagree — proving the snapshot is the guard.
    assert.equal(mutableReader.getActiveMode().templateType, 'general');
  });

  test('mode-blind defaults when reader is absent or throws (never throws)', () => {
    const blank = buildWhatToAnswerRequestSnapshot({ requestId: 'r', generationId: 1 });
    assert.equal(blank.activeModeInfo, null);
    assert.equal(blank.modeId, 'general');
    assert.equal(blank.modeUniqueId, undefined);

    const thrower = {
      getActiveModeInfo: () => { throw new Error('db down'); },
      getActiveMode: () => { throw new Error('db down'); },
    };
    const safe = buildWhatToAnswerRequestSnapshot({ modeReader: thrower, requestId: 'r', generationId: 2 });
    assert.equal(safe.activeModeInfo, null);
    assert.equal(safe.modeId, 'general');
  });

  test('no active mode → null info, general id (matches mode-blind live semantics)', () => {
    const noneReader = { getActiveModeInfo: () => null, getActiveMode: () => null };
    const snap = buildWhatToAnswerRequestSnapshot({ modeReader: noneReader, requestId: 'r', generationId: 1 });
    assert.equal(snap.activeModeInfo, null);
    assert.equal(snap.modeId, 'general');
    assert.equal(snap.modeUniqueId, undefined);
  });
});

describe('resolveLiveAnswerBatch (#3 — drop superseded live tokens)', () => {
  test('id-less items are always accepted, active id unchanged (backward compatible)', () => {
    assert.deepEqual(resolveLiveAnswerBatch(null, undefined), { accept: true, activeId: null });
    assert.deepEqual(resolveLiveAnswerBatch(5, undefined), { accept: true, activeId: 5 });
  });

  test('adopts the first numeric id', () => {
    assert.deepEqual(resolveLiveAnswerBatch(null, 3), { accept: true, activeId: 3 });
  });

  test('accepts same id, advances on a newer id, drops an older (superseded) id', () => {
    assert.deepEqual(resolveLiveAnswerBatch(3, 3), { accept: true, activeId: 3 });
    assert.deepEqual(resolveLiveAnswerBatch(3, 4), { accept: true, activeId: 4 });
    // The core fix: a stale generation's already-queued batch is dropped.
    assert.deepEqual(resolveLiveAnswerBatch(4, 3), { accept: false, activeId: 4 });
  });

  test('a real interleave: old gen tokens after a newer answer started are dropped', () => {
    let active = null;
    const seen = [];
    // gen 10 streams two tokens, renderer adopts 10.
    for (const id of [10, 10]) {
      const d = resolveLiveAnswerBatch(active, id); active = d.activeId;
      if (d.accept) seen.push(`g10`);
    }
    // gen 11 (new "what to answer" press) starts; renderer adopts 11.
    {
      const d = resolveLiveAnswerBatch(active, 11); active = d.activeId;
      if (d.accept) seen.push('g11');
    }
    // A straggler batch from gen 10 (queued in main before supersession) arrives —
    // must be DROPPED so it can't append to gen 11's bubble.
    {
      const d = resolveLiveAnswerBatch(active, 10); active = d.activeId;
      if (d.accept) seen.push('g10-straggler');
    }
    assert.deepEqual(seen, ['g10', 'g10', 'g11'], 'the stale gen-10 straggler must be dropped');
    assert.equal(active, 11);
  });
});
