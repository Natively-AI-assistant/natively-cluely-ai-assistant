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

test('commitStreamingFlush writes buffered tokens onto placeholder row', () => {
  const messages = [
    { id: 'ph', role: 'system', text: '', intent: 'chat', isStreaming: true },
  ];
  const flushed = commitStreamingFlush(messages, 'ph', 'Hello world!');
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].text, 'Hello world!');
  assert.equal(flushed[0].isStreaming, false);
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
