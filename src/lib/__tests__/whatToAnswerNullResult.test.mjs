import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatToAnswerNullFeedbackMessages,
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
