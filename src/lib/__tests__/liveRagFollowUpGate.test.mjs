import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldSkipLiveRagForChatFollowUp } from '../liveRagFollowUpGate.mjs';

test('first question with no prior chat always uses live RAG', () => {
  assert.equal(shouldSkipLiveRagForChatFollowUp('lc 573', { hasPriorChat: false }), false);
  assert.equal(
    shouldSkipLiveRagForChatFollowUp('what did John say about the API?', { hasPriorChat: false }),
    false,
  );
});

test('short referential follow-ups skip live RAG when prior chat exists (issue #552)', () => {
  assert.equal(shouldSkipLiveRagForChatFollowUp('do via stack', { hasPriorChat: true }), true);
  assert.equal(shouldSkipLiveRagForChatFollowUp('explain that more', { hasPriorChat: true }), true);
  assert.equal(shouldSkipLiveRagForChatFollowUp('why?', { hasPriorChat: true }), true);
  assert.equal(shouldSkipLiveRagForChatFollowUp('and then?', { hasPriorChat: true }), true);
});

test('longer deictic / refinement follow-ups skip live RAG', () => {
  assert.equal(
    shouldSkipLiveRagForChatFollowUp('can you explain that approach in more detail', {
      hasPriorChat: true,
    }),
    true,
  );
  assert.equal(
    shouldSkipLiveRagForChatFollowUp('make that shorter and simpler please', { hasPriorChat: true }),
    true,
  );
});

test('self-contained questions still use live RAG even with prior chat', () => {
  assert.equal(
    shouldSkipLiveRagForChatFollowUp(
      'what decisions were made about the billing migration timeline this week',
      { hasPriorChat: true },
    ),
    false,
  );
  assert.equal(
    shouldSkipLiveRagForChatFollowUp(
      'summarize the key risks from the launch plan discussed earlier today in detail please',
      { hasPriorChat: true },
    ),
    // "earlier" alone is not enough once the turn is a long self-contained ask
    // with >12 words — live RAG should still run.
    false,
  );
});

test('empty question never skips', () => {
  assert.equal(shouldSkipLiveRagForChatFollowUp('', { hasPriorChat: true }), false);
  assert.equal(shouldSkipLiveRagForChatFollowUp('   ', { hasPriorChat: true }), false);
});
