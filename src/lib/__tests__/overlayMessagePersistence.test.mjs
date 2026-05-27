import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
} from '../overlayMessagePersistence.mjs';

const priorMessages = [
  { id: 'u1', role: 'user', text: 'Hello' },
  { id: 'a1', role: 'system', text: 'Prior answer', intent: 'what_to_answer', isStreaming: false },
  { id: 'u2', role: 'user', text: 'Follow-up' },
];

test('clarify placeholder does not clear messages', () => {
  const next = prepareIntelligenceStreamPlaceholderMessages(priorMessages, 'clarify', 'ph-clarify');
  assert.equal(next.length, priorMessages.length + 1);
  assert.equal(next[0].text, 'Hello');
  assert.equal(next[1].text, 'Prior answer');
  assert.equal(next[next.length - 1].intent, 'clarify');
  assert.equal(next[next.length - 1].isStreaming, true);
});

test('clarify finalize does not clear messages', () => {
  const withPlaceholder = prepareIntelligenceStreamPlaceholderMessages(
    priorMessages,
    'clarify',
    'ph-clarify',
  );
  const next = finalizeStreamingByIntentMessages(
    withPlaceholder,
    'clarify',
    'Here is clarification.',
    () => 'final-id',
  );
  assert.equal(next.length, withPlaceholder.length);
  assert.equal(next.filter((m) => m.role === 'user').length, 2);
  assert.equal(next.find((m) => m.intent === 'clarify')?.text, 'Here is clarification.');
  assert.equal(next.find((m) => m.intent === 'clarify')?.isStreaming, false);
});

test('clarify finalize updates last matching intent row only', () => {
  const rows = [
    ...priorMessages,
    { id: 'c1', role: 'system', text: 'old', intent: 'clarify', isStreaming: false },
    { id: 'c2', role: 'system', text: '', intent: 'clarify', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'clarify', 'new text', () => 'x');
  assert.equal(next.length, rows.length);
  assert.equal(next.find((m) => m.id === 'c1')?.text, 'old');
  assert.equal(next.find((m) => m.id === 'c2')?.text, 'new text');
});

test('what_to_answer finalize updates last row only (findLastIndex — RC-D)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first click stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'what_to_answer', 'final answer', () => 'w3');
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first click stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'final answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize prefers explicit streamingMsgId over findLastIndex (Fix 3)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'targeted answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'targeted answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize appends when no prior system row (blank first click path)', () => {
  const next = finalizeStreamingByIntentMessages([], 'what_to_answer', 'only answer', () => 'wta-1');
  assert.equal(next.length, 1);
  assert.equal(next[0].intent, 'what_to_answer');
  assert.equal(next[0].text, 'only answer');
});

test('RC-E: explicit streamingMsgId finalizes correct row when user message is between WTA rows', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first answer', intent: 'what_to_answer', isStreaming: false },
    { id: 'u1', role: 'user', text: 'manual question between clicks' },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'second answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 3);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first answer');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'second answer');
  assert.equal(next.find((m) => m.id === 'w2')?.isStreaming, false);
  assert.equal(next.find((m) => m.id === 'u1')?.text, 'manual question between clicks');
});
