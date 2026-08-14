import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFirstStreamingToken,
  commitStreamingFlush,
  discardStreamingBufferWhenNoMsgId,
  findOpenStreamingRowIndex,
  hasActiveOpenStream,
  resolveStreamingMessageId,
  shouldFlushPreviousStream,
  simulateDeferredFirstTokenVsSyncFinalize,
  simulatePrewiredPlaceholderStream,
  simulatePrewiredPlaceholderWithSyncFinalize,
  simulateSameIntentTokenStream,
  simulateLateWtaAfterChatPlaceholder,
  finalizeImperativeStreamMessages,
} from '../streamingTokenQueue.mjs';
import { prepareIntelligenceStreamPlaceholderMessages } from '../overlayMessagePersistence.mjs';

test('shouldFlushPreviousStream keeps same-intent tokens in one bubble', () => {
  assert.equal(shouldFlushPreviousStream('chat', 'chat', 'msg-1'), false);
  assert.equal(shouldFlushPreviousStream('clarify', 'clarify', 'msg-1'), false);
  assert.equal(shouldFlushPreviousStream('what_to_answer', 'what_to_answer', 'msg-1'), false);
});

test('shouldFlushPreviousStream flushes when intent changes mid-stream', () => {
  assert.equal(shouldFlushPreviousStream('chat', 'clarify', 'msg-1'), true);
  assert.equal(shouldFlushPreviousStream('what_to_answer', 'clarify', 'msg-1'), true);
});

test('shouldFlushPreviousStream flushes chat stream when what_to_answer arrives (manual submit flood path)', () => {
  assert.equal(shouldFlushPreviousStream('chat', 'what_to_answer', 'msg-chat'), true);
  assert.equal(shouldFlushPreviousStream('what_to_answer', 'chat', 'msg-wta'), true);
});

test('shouldFlushPreviousStream does not flush when no active stream', () => {
  assert.equal(shouldFlushPreviousStream(null, 'chat', null), false);
  assert.equal(shouldFlushPreviousStream('chat', 'chat', null), false);
});

test('hasActiveOpenStream treats placeholder (empty text) as active', () => {
  assert.equal(hasActiveOpenStream('placeholder-id'), true);
  assert.equal(hasActiveOpenStream(null), false);
});

test('same-intent stream keeps one bubble (no flush between tokens)', () => {
  assert.equal(shouldFlushPreviousStream('clarify', 'clarify', 'ph-1'), false);
  assert.equal(shouldFlushPreviousStream('follow_up_questions', 'follow_up_questions', 'ph-1'), false);
});

test('multi-token same-intent simulation produces exactly one streaming row', () => {
  const tokens = ['Hello', ' ', 'world', '!'];
  const rows = simulateSameIntentTokenStream([], tokens, 'chat', () => 'stream-1');
  const streaming = rows.filter((m) => m.role === 'system' && m.isStreaming);
  assert.equal(streaming.length, 1);
  assert.equal(streaming[0].text, 'Hello world!');
  assert.equal(streaming[0].intent, 'chat');
});

test('multi-token same-intent reuses placeholder row instead of appending', () => {
  const placeholder = {
    id: 'ph-clarify',
    role: 'system',
    text: '',
    intent: 'clarify',
    isStreaming: true,
  };
  const tokens = ['Need', ' more', ' context'];
  const rows = simulateSameIntentTokenStream([placeholder], tokens, 'clarify', () => 'new-id');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'ph-clarify');
  assert.equal(rows[0].text, 'Need more context');
});

test('resolveStreamingMessageId reuses open placeholder id', () => {
  const messages = [
    { id: 'ph', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  assert.equal(resolveStreamingMessageId(messages, null, 'chat', () => 'new'), 'ph');
  assert.equal(findOpenStreamingRowIndex(messages, 'chat'), 0);
});

test('applyFirstStreamingToken updates existing row by id', () => {
  const prev = [{ id: 'ph', role: 'system', text: '', intent: 'chat', isStreaming: true }];
  const next = applyFirstStreamingToken(prev, { id: 'ph', token: 'Hi', intent: 'chat' });
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'Hi');
});

// Regression: race fix. If finalize already committed this row (isStreaming=false),
// a late-arriving mount must NOT append the token (would double the text) and must
// NOT re-open the stream (would re-trigger the streaming render branch).
test('applyFirstStreamingToken is idempotent against a pre-finalized row', () => {
  const prev = [
    { id: 'race-1', role: 'system', text: 'final text', intent: 'what_to_answer', isStreaming: false },
  ];
  const next = applyFirstStreamingToken(prev, {
    id: 'race-1',
    token: 'final text',
    intent: 'what_to_answer',
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'final text', 'must not double the text');
  assert.equal(next[0].isStreaming, false, 'must not re-open the stream');
  assert.equal(next, prev, 'should return same reference (no-op)');
});

// Regression: id-collision fix. newMessageId() (crypto.randomUUID with
// counter-suffixed-timestamp fallback) replaced 33 Date.now().toString() sites
// in NativelyInterface.tsx. If a fresh stream id COLLIDES with a just-finalized
// row id, applyFirstStreamingToken NO-OPs (see the idempotency test above) and
// silently drops the first token. The collision-avoidance pathway is that a
// DIFFERENT id must create a brand-new streaming row — even when a finalized
// row with the same intent already exists.
test('applyFirstStreamingToken appends a new row when id differs from a pre-finalized row (collision-avoidance)', () => {
  const prev = [
    { id: 'race-A', role: 'system', text: 'final text', intent: 'what_to_answer', isStreaming: false },
  ];
  const next = applyFirstStreamingToken(prev, {
    id: 'race-B',
    token: 'first token',
    intent: 'what_to_answer',
  });
  assert.equal(next.length, 2, 'must append a new row, not no-op against the finalized row');
  assert.notEqual(next, prev, 'must return a new array reference');
  // Original finalized row must stay untouched.
  assert.equal(next[0].id, 'race-A');
  assert.equal(next[0].text, 'final text');
  assert.equal(next[0].isStreaming, false);
  // New streaming row carries the first token under the fresh id.
  assert.equal(next[1].id, 'race-B');
  assert.equal(next[1].role, 'system');
  assert.equal(next[1].text, 'first token', 'first token must not be dropped');
  assert.equal(next[1].intent, 'what_to_answer');
  assert.equal(next[1].isStreaming, true);
});

test('commitStreamingFlush writes buffered tokens onto placeholder row', () => {
  const messages = [
    { id: 'ph', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  const flushed = commitStreamingFlush(messages, 'ph', 'Hello world!');
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].text, 'Hello world!');
  assert.equal(flushed[0].isStreaming, false);
});

test('finalizeImperativeStreamMessages commits final text once without intermediate buffered replacement', () => {
  const messages = [
    { id: 'ph', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  const finalized = finalizeImperativeStreamMessages(messages, {
    msgId: 'ph',
    intent: 'chat',
    bufferedText: '```js\nconsole.log("old")\n```',
    finalText: '```js\nconsole.log("final")\n```',
  });

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].text, '```js\nconsole.log("final")\n```');
  assert.equal(finalized[0].isStreaming, false);
});

test('finalizeImperativeStreamMessages appends by reserved id if row has not mounted yet', () => {
  const finalized = finalizeImperativeStreamMessages([], {
    msgId: 'reserved-id',
    intent: 'what_to_answer',
    bufferedText: '```python\nprint(1)\n```',
    finalText: '```python\nprint(1)\n```',
  });

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].id, 'reserved-id');
  assert.equal(finalized[0].role, 'system');
  assert.equal(finalized[0].intent, 'what_to_answer');
  assert.equal(finalized[0].text, '```python\nprint(1)\n```');
  assert.equal(finalized[0].isStreaming, false);
});

test('pre-wired placeholder stream keeps one bubble with visible text after flush', () => {
  const placeholder = {
    id: 'ph-chat',
    role: 'system',
    text: '',
    intent: 'chat',
    isStreaming: true,
  };
  const tokens = ['The', ' answer', ' is', ' 42'];
  const rows = simulatePrewiredPlaceholderStream([placeholder], tokens, 'chat', 'ph-chat');
  const systemRows = rows.filter((m) => m.role === 'system');
  assert.equal(systemRows.length, 1);
  assert.equal(systemRows[0].id, 'ph-chat');
  assert.equal(systemRows[0].text, 'The answer is 42');
  assert.equal(systemRows[0].isStreaming, false);
});

test('tokens visible in one bubble — no duplicate rows during pre-wired stream', () => {
  const placeholder = {
    id: 'ph-chat',
    role: 'system',
    text: '',
    intent: 'chat',
    isStreaming: true,
  };
  const tokens = ['One', ' ', 'bubble', ' ', 'only'];
  const rows = simulatePrewiredPlaceholderStream([placeholder], tokens, 'chat', 'ph-chat');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'One bubble only');
  assert.equal(rows.filter((m) => m.isStreaming).length, 0);
});

test('discardStreamingBufferWhenNoMsgId clears buffered text when msgId unset (RC-C flushToken)', () => {
  assert.equal(discardStreamingBufferWhenNoMsgId('full answer blob'), '');
  assert.equal(discardStreamingBufferWhenNoMsgId(''), '');
});

test('deferred first token + sync finalize must yield one what_to_answer row (RC-C repro)', () => {
  const answer = 'You should emphasize your experience with distributed systems.';
  let seq = 0;
  const idFactory = () => `wta-id-${++seq}`;
  const rows = simulateDeferredFirstTokenVsSyncFinalize([], {
    intent: 'what_to_answer',
    token: answer,
    finalText: answer,
    idFactory,
  });
  const wta = rows.filter((m) => m.role === 'system' && m.intent === 'what_to_answer');
  assert.equal(
    wta.length,
    1,
    `expected one row after Fix 1; got ${wta.length} rows: ${JSON.stringify(wta.map((m) => m.text))}`,
  );
});

test('findLastIndex finalize + deferred first token must not add a third what_to_answer row (RC-D repro)', () => {
  const prior = [
    { id: 'w1', role: 'system', text: 'stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: 'older', intent: 'what_to_answer', isStreaming: false },
  ];
  const answer = 'Repeated flood text.';
  const rows = simulateDeferredFirstTokenVsSyncFinalize(prior, {
    intent: 'what_to_answer',
    token: answer,
    finalText: answer,
    idFactory: () => 'wta-new',
  });
  const wta = rows.filter((m) => m.intent === 'what_to_answer');
  assert.equal(wta.length, 2, 'should update w2 in place, not append wta-new');
  assert.equal(wta[0].text, 'stale');
  assert.equal(wta[1].text, answer);
  assert.equal(wta[1].id, 'w2');
});

test('pre-wired what_to_answer placeholder + sync finalize stays one row (control)', () => {
  const answer = 'Single visible answer.';
  const withPlaceholder = prepareIntelligenceStreamPlaceholderMessages(
    [],
    'what_to_answer',
    'ph-wta',
  );
  const rows = simulatePrewiredPlaceholderWithSyncFinalize(withPlaceholder, {
    intent: 'what_to_answer',
    tokens: [answer],
    finalText: answer,
    placeholderId: 'ph-wta',
    idFactory: () => 'should-not-append',
  });
  const wta = rows.filter((m) => m.intent === 'what_to_answer');
  assert.equal(wta.length, 1);
  assert.equal(wta[0].id, 'ph-wta');
  assert.equal(wta[0].text, answer);
  assert.equal(wta[0].isStreaming, false);
});

test('RC-F: late WTA finalize ignored when chat placeholder active after manual submit', () => {
  const afterManualSubmit = [
    { id: 'u1', role: 'user', text: 'my question' },
    { id: 'ph-chat', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  const rows = simulateLateWtaAfterChatPlaceholder(afterManualSubmit, {
    wtaAnswer: 'stale WTA answer',
    chatPlaceholderId: 'ph-chat',
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((m) => m.id === 'ph-chat')?.isStreaming, true);
  assert.equal(rows.filter((m) => m.intent === 'what_to_answer').length, 0);
});

// Regression: orphan-placeholder race fix in NativelyInterface.queueToken.
// Previously, the first-token branch passed `() => reservedId` as idFactory to
// resolveStreamingMessageId, but resolveStreamingMessageId reuses an existing
// open same-intent row's id when one exists — so a stale orphan
// isStreaming=true row would steal the active id and race with a concurrent
// finalize keyed on `reservedId`. Fix: (1) always mount with `reservedId`,
// (2) seal any orphan isStreaming=true same-intent rows (id !== reservedId)
// before applyFirstStreamingToken. This guarantees the new bubble owns its
// own id and orphans cannot re-enter the streaming branch.
test('seal-orphans pattern: orphan same-intent row gets isStreaming=false and a new reservedId row is appended', () => {
  const prev = [
    { id: 'orphan-1', role: 'system', text: 'stale partial', intent: 'what_to_answer', isStreaming: true },
  ];
  const reservedId = 'new-id';
  const intent = 'what_to_answer';
  const token = 'fresh ';

  // Inline simulation of the queueToken seal pattern:
  // 1) Seal orphan isStreaming=true same-intent rows where id !== reservedId.
  const sealed = prev.map((m) =>
    m.role === 'system' && m.isStreaming && m.intent === intent && m.id !== reservedId
      ? { ...m, isStreaming: false }
      : m,
  );
  // 2) Mount the first token with reservedId (NOT a resolved id from sealed rows).
  const next = applyFirstStreamingToken(sealed, { id: reservedId, token, intent });

  assert.equal(next.length, 2, 'orphan stays, new reservedId row is appended');

  const orphan = next.find((m) => m.id === 'orphan-1');
  assert.ok(orphan, 'orphan row must still exist');
  assert.equal(orphan.isStreaming, false, 'orphan must be sealed (no longer streaming)');
  assert.equal(orphan.text, 'stale partial', 'orphan text must be preserved when sealed');
  assert.equal(orphan.intent, 'what_to_answer');

  const fresh = next.find((m) => m.id === reservedId);
  assert.ok(fresh, 'new reservedId row must be appended');
  assert.equal(fresh.role, 'system');
  assert.equal(fresh.text, token, 'fresh row carries the first token text');
  assert.equal(fresh.intent, 'what_to_answer');
  assert.equal(fresh.isStreaming, true, 'fresh row owns the active stream');

  // Critical: only ONE streaming row remains — no race over which id is "active".
  const streamingRows = next.filter((m) => m.isStreaming);
  assert.equal(streamingRows.length, 1);
  assert.equal(streamingRows[0].id, reservedId);
});

// Regression (Fix A — cross-flow late-finalize):
// finalizeStreamingByIntent in NativelyInterface.tsx now consults
// shouldAcceptIntelligenceIpc and, when the active stream is a DIFFERENT
// intent (e.g. chat placeholder still open), passes streamingMsgId=null to
// finalizeStreamingByIntentMessages. With streamingMsgId=null, the function
// must NOT walk back and clobber an open row of a different intent — it
// must append a fresh row for the incoming intent. shouldAcceptIntelligenceIpc
// itself is covered below; this test pins down the *messages-level* contract.
test('cross-intent finalize does not clobber different-intent placeholder', async () => {
  const { finalizeStreamingByIntentMessages } = await import('../overlayMessagePersistence.mjs');
  const messages = [
    { id: 'chat-1', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  let seq = 0;
  const idFactory = () => `wta-${++seq}`;
  const next = finalizeStreamingByIntentMessages(
    messages,
    'what_to_answer',
    'stale WTA text',
    idFactory,
    null, // cross-intent → null per Fix A
  );

  // chat-1 must be untouched: still empty text, still streaming.
  const chatRow = next.find((m) => m.id === 'chat-1');
  assert.ok(chatRow, 'chat placeholder must still exist');
  assert.equal(chatRow.text, '', 'chat placeholder text must remain empty');
  assert.equal(chatRow.isStreaming, true, 'chat placeholder must remain streaming');
  assert.equal(chatRow.intent, 'chat');

  // A NEW what_to_answer row must have been appended (not merged into chat-1).
  const wtaRows = next.filter((m) => m.intent === 'what_to_answer');
  assert.equal(wtaRows.length, 1, 'exactly one new wta row must be appended');
  assert.notEqual(wtaRows[0].id, 'chat-1', 'new row must not steal chat-1 id');
  assert.equal(wtaRows[0].text, 'stale WTA text');
  assert.equal(wtaRows[0].isStreaming, false);
  assert.equal(next.length, 2, 'exactly two rows: untouched chat-1 + new wta');
});

test('shouldAcceptIntelligenceIpc rejects late WTA when chat stream is open', async () => {
  const { shouldAcceptIntelligenceIpc } = await import('../overlayIntelligenceGeneration.mjs');
  assert.equal(
    shouldAcceptIntelligenceIpc({
      eventIntent: 'what_to_answer',
      activeStreamIntent: 'chat',
      hasActiveOpenStream: true,
    }),
    false,
  );
  assert.equal(
    shouldAcceptIntelligenceIpc({
      eventIntent: 'what_to_answer',
      activeStreamIntent: 'what_to_answer',
      hasActiveOpenStream: true,
    }),
    true,
  );
});
