import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatToAnswerNullFeedbackMessages,
  applyWhatToAnswerNullFeedbackMessagesUnlessAnswered,
  prepareIntelligenceStreamPlaceholderMessages,
} from '../overlayMessagePersistence.mjs';

test('null invoke with open WTA placeholder updates one row with feedback (RC-A UI path)', () => {
  const withPlaceholder = prepareIntelligenceStreamPlaceholderMessages(
    [],
    'what_to_answer',
    'ph-wta',
  );
  const feedback = 'Please wait — cooldown active.';
  const next = applyWhatToAnswerNullFeedbackMessages(withPlaceholder, feedback, () => 'fb-1');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'ph-wta');
  assert.equal(next[0].text, feedback);
  assert.equal(next[0].isStreaming, false);
});

test('null invoke without placeholder appends new system row', () => {
  const prior = [{ id: 'u1', role: 'user', text: 'Hello' }];
  const feedback = 'Could not generate an answer yet.';
  const next = applyWhatToAnswerNullFeedbackMessages(prior, feedback, () => 'sys-1');
  assert.equal(next.length, 2);
  const row = next.find((m) => m.id === 'sys-1');
  assert.ok(row);
  assert.equal(row.intent, 'what_to_answer');
  assert.equal(row.text, feedback);
  assert.equal(row.isStreaming, false);
});

test('null invoke ignores sealed what_to_answer rows (negative: no duplicate)', () => {
  const prior = [
    { id: 'w1', role: 'system', text: 'prior', intent: 'what_to_answer', isStreaming: false },
  ];
  const next = applyWhatToAnswerNullFeedbackMessages(prior, 'cooldown', () => 'w2');
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'prior');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'cooldown');
});

test('null invoke does not overwrite an answer already delivered via streaming IPC', () => {
  const prior = [
    {
      id: 'ph-wta',
      role: 'system',
      intent: 'what_to_answer',
      text: 'Yes. The platform replaces five separate live ops tools with one integrated system.',
      isStreaming: false,
    },
  ];
  const next = applyWhatToAnswerNullFeedbackMessagesUnlessAnswered(
    prior,
    'Could not generate an answer yet.',
    () => 'err-1',
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'ph-wta');
  assert.match(next[0].text, /integrated system/);
});

test('null invoke seals an in-flight streaming row that already has answer text', () => {
  const prior = prepareIntelligenceStreamPlaceholderMessages([], 'what_to_answer', 'ph-wta');
  prior[0].text =
    'Yes. The gist is that indie studios patch together many tools after launch.';
  const next = applyWhatToAnswerNullFeedbackMessagesUnlessAnswered(
    prior,
    'Could not generate an answer yet.',
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].isStreaming, false);
  assert.match(next[0].text, /indie studios/);
});
