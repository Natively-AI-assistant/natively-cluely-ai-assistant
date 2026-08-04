// electron/services/__tests__/StaleResponseModeSwitch2026_08_01.test.mjs
//
// Defect G — a manual-chat answer generated under one mode could be delivered
// after the user switched modes, landing visually as the NEW mode's answer.
//
// Root cause: `modes:set-active` aborted every in-flight chat stream but never
// deleted the `_chatStreamsBySender` registry entries, so every streamId
// supersession guard (`get(senderId)?.streamId !== myStreamId`) still said
// "I am current" — the abort was a race against the provider HTTP stream, not
// a decision. Fix = registry invalidation (abortAndInvalidateChatStreams) +
// mode-identity checks BEFORE the user-visible `gemini-stream-done` emits +
// renderer teardown of in-flight UI state on mode change.
//
// Part 1 tests the extracted helper functionally (imported from the compiled
// dist-electron output, same convention as ConversationMemoryService.test.mjs
// — run `npm run build:electron` first). Part 2 pins the wiring by structure
// (handler/function names, never line numbers), same convention as
// ModeBleeding.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { abortAndInvalidateChatStreams } = await import(
  '../../../dist-electron/electron/services/chatStreamRegistry.js'
);

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — functional: registry invalidation makes the streamId guards
// deterministic.
// ─────────────────────────────────────────────────────────────────────────────

function makeEntry(streamId) {
  const entry = {
    streamId,
    aborted: false,
    controller: { abort() { entry.aborted = true; } },
  };
  return entry;
}

describe('abortAndInvalidateChatStreams (Defect G registry invalidation)', () => {
  test('aborts every entry AND deletes it from the registry', () => {
    const map = new Map();
    const a = makeEntry(3);
    const b = makeEntry(7);
    map.set(101, a);
    map.set(202, b);

    const n = abortAndInvalidateChatStreams(map);

    assert.equal(n, 2, 'reports how many streams were invalidated');
    assert.equal(a.aborted, true, 'sender 101 controller aborted');
    assert.equal(b.aborted, true, 'sender 202 controller aborted');
    assert.equal(map.size, 0, 'registry must be EMPTY after invalidation — the delete is the load-bearing half');
  });

  test('after invalidation, a stale streamId guard reports superseded (the exact guard shape used ~10x in ipcHandlers)', () => {
    const map = new Map();
    const senderId = 55;
    const myStreamId = 9;
    map.set(senderId, makeEntry(myStreamId));

    // Before the mode switch the stream believes it is current.
    assert.equal(map.get(senderId)?.streamId !== myStreamId, false, 'pre-switch: guard says current');

    // Simulate modes:set-active firing mid-generation.
    abortAndInvalidateChatStreams(map);

    // The SAME guard expression every emit site uses must now say superseded —
    // deterministically, regardless of how the abort raced the provider.
    assert.equal(
      map.get(senderId)?.streamId !== myStreamId,
      true,
      'post-switch: guard must report superseded even though the provider stream may have finished before the abort landed',
    );
  });

  test('a throwing abort() does not prevent the delete (invalidation must not depend on abort succeeding)', () => {
    const map = new Map();
    map.set(1, { streamId: 4, controller: { abort() { throw new Error('already finished'); } } });
    map.set(2, makeEntry(5));

    const n = abortAndInvalidateChatStreams(map);

    assert.equal(n, 2);
    assert.equal(map.size, 0, 'both entries deleted, including the one whose abort threw');
  });

  test('empty registry is a no-op', () => {
    const map = new Map();
    assert.equal(abortAndInvalidateChatStreams(map), 0);
    assert.equal(map.size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — source-grep contracts (structure-located, never line numbers).
// ─────────────────────────────────────────────────────────────────────────────

const ipcSource = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('Defect G contract: modes:set-active invalidates the chat-stream registry', () => {
  test('the handler calls abortAndInvalidateChatStreams(_chatStreamsBySender) instead of a bare abort loop', () => {
    const handlerBody = sliceSafeHandleBlock(ipcSource, 'modes:set-active');
    assert.ok(handlerBody.length > 0, 'modes:set-active handler must exist');
    assert.ok(
      handlerBody.includes('abortAndInvalidateChatStreams(_chatStreamsBySender)'),
      'modes:set-active must abort AND DELETE registry entries via abortAndInvalidateChatStreams — abort() alone is a race, not a decision',
    );
  });

  test('invalidation happens BEFORE setActiveMode flips the mode', () => {
    const handlerBody = sliceSafeHandleBlock(ipcSource, 'modes:set-active');
    const invalidateIdx = handlerBody.indexOf('abortAndInvalidateChatStreams(_chatStreamsBySender)');
    const setActiveIdx = handlerBody.indexOf('ModesManager.getInstance().setActiveMode');
    assert.ok(invalidateIdx >= 0, 'invalidation call must exist');
    assert.ok(setActiveIdx >= 0, 'setActiveMode call must exist');
    assert.ok(
      invalidateIdx < setActiveIdx,
      `registry invalidation (index ${invalidateIdx}) must run before setActiveMode (index ${setActiveIdx})`,
    );
  });
});

describe('Defect G contract: mode-identity check precedes the user-visible done emits', () => {
  // The manual-chat handler body: from its declaration to where it is registered.
  const handlerStart = ipcSource.indexOf('const _geminiChatStreamHandler = async (');
  const handlerEnd = ipcSource.indexOf("safeHandle('gemini-chat-stream', _geminiChatStreamHandler)");
  const handlerBody = ipcSource.slice(handlerStart, handlerEnd);

  test('manual-chat handler is locatable by structure', () => {
    assert.ok(handlerStart >= 0, '_geminiChatStreamHandler declaration must exist');
    assert.ok(handlerEnd > handlerStart, 'handler registration must follow the declaration');
  });

  test('V3 block: liveModeIdAtEmit comparison occurs BEFORE the V3 gemini-stream-done emit', () => {
    // The V3 done emit is the only one shaped exactly `{ finalText, streamId: myStreamId }`.
    const v3DoneIdx = handlerBody.indexOf("send('gemini-stream-done', { finalText, streamId: myStreamId })");
    assert.ok(v3DoneIdx >= 0, 'V3 done emit must exist');

    const emitGuardIdx = handlerBody.indexOf('liveModeIdAtEmit');
    assert.ok(emitGuardIdx >= 0, 'a liveModeIdAtEmit identity guard must exist in the V3 block');
    assert.ok(
      emitGuardIdx < v3DoneIdx,
      `the mode-identity guard (index ${emitGuardIdx}) must be evaluated BEFORE the V3 done emit (index ${v3DoneIdx}) — it must gate the user-visible answer, not just the memory writes`,
    );

    // It must compare live vs request-time mode by .id and suppress on mismatch.
    const guardBlock = handlerBody.slice(emitGuardIdx - 400, v3DoneIdx);
    assert.match(guardBlock, /getActiveMode\(\)\?\.id/, 'the V3 emit guard must read the LIVE mode by .id');
    assert.ok(
      guardBlock.includes('liveModeIdAtEmit !== v3RequestModeId'),
      'the V3 emit guard must compare live mode id against the request-time (captured) mode id',
    );
    assert.ok(
      guardBlock.includes('stale stream suppressed: mode changed mid-generation'),
      'suppression must log the structured stale-stream line',
    );
    assert.ok(
      /liveModeIdAtEmit !== v3RequestModeId[\s\S]{0,400}?return null/.test(guardBlock),
      'on mismatch the V3 block must return (skip the emit), not merely log',
    );
  });

  test('V3 block: the existing liveModeIdAtRecord memory-write guard is preserved (defense in depth)', () => {
    const recordGuardIdx = handlerBody.indexOf('liveModeIdAtRecord');
    assert.ok(recordGuardIdx >= 0, 'liveModeIdAtRecord record guard must still exist — the emit guard does not replace it');
  });

  test('LEGACY block: liveModeIdAtDoneEmit comparison gates the legacy gemini-stream-done emit', () => {
    // The legacy done emit is the only one with the conditional-finalText spread.
    const legacyDoneIdx = handlerBody.indexOf("send('gemini-stream-done', { ...(finalText ? { finalText } : {}), streamId: myStreamId })");
    assert.ok(legacyDoneIdx >= 0, 'legacy done emit must exist');

    const legacyGuardIdx = handlerBody.indexOf('liveModeIdAtDoneEmit');
    assert.ok(legacyGuardIdx >= 0, 'a liveModeIdAtDoneEmit identity guard must exist on the legacy path');
    assert.ok(
      legacyGuardIdx < legacyDoneIdx,
      `the legacy mode-identity guard (index ${legacyGuardIdx}) must be evaluated BEFORE the legacy done emit (index ${legacyDoneIdx})`,
    );

    const guardBlock = handlerBody.slice(legacyGuardIdx, legacyDoneIdx);
    assert.match(guardBlock, /getActiveMode\(\)\?\.id/, 'the legacy emit guard must read the LIVE mode by .id');
    assert.ok(
      guardBlock.includes('liveModeIdAtDoneEmit !== (manualActiveMode?.id ?? null)'),
      'the legacy emit guard must compare against the CAPTURED manualActiveMode by .id',
    );
    assert.ok(
      guardBlock.includes('stale stream suppressed: mode changed mid-generation'),
      'suppression must log the structured stale-stream line',
    );
  });
});

describe('Defect G contract: renderer tears down in-flight chat UI on mode change', () => {
  const rendererSource = fs.readFileSync(
    path.resolve(__dirname, '../../../src/components/NativelyInterface.tsx'),
    'utf8',
  );

  test('the onModeChanged subscription calls cancelActiveChatStream()', () => {
    const subIdx = rendererSource.indexOf('window.electronAPI?.onModeChanged?.(');
    assert.ok(subIdx >= 0, 'onModeChanged subscription must exist');

    // The subscription callback is small; scan the callback region up to the
    // effect's unsubscribe return, located by structure not line numbers.
    const unsubIdx = rendererSource.indexOf('return () => unsub?.();', subIdx);
    assert.ok(unsubIdx > subIdx, 'the subscription effect must return its unsubscribe');
    const callbackRegion = rendererSource.slice(subIdx, unsubIdx);
    assert.ok(
      callbackRegion.includes('cancelActiveChatStream()'),
      'onModeChanged must call cancelActiveChatStream() — a mode switch must tear down in-flight stream/placeholder state, not just relabel the badge',
    );
  });

  test('cancelActiveChatStream stops the stream and drops a tokenless streaming placeholder without touching committed rows', () => {
    const fnIdx = rendererSource.indexOf('const cancelActiveChatStream = useCallback(');
    assert.ok(fnIdx >= 0, 'cancelActiveChatStream must exist');
    const fnBody = rendererSource.slice(fnIdx, fnIdx + 2500);
    assert.ok(fnBody.includes('cancelChatStream?.()'), 'must stop the main-process stream');
    assert.ok(fnBody.includes('flushToken()'), 'must finalize partial streamed text (keeps it as committed history)');
    // The tokenless-placeholder cleanup must be scoped to the exact in-flight
    // row: matched by id AND still streaming AND empty — committed rows never match.
    assert.ok(
      /m\.id === danglingId && m\.isStreaming && !m\.text/.test(fnBody),
      'placeholder removal must be scoped to the in-flight tokenless row only (id + isStreaming + empty text)',
    );
  });
});
