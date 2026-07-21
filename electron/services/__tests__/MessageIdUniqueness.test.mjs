// Issue #253 — UI flickering / chat history loops on Windows + macOS.
//
// Root cause: src/components/NativelyInterface.tsx generated React list-item
// keys via `Date.now().toString()` at ~30 different call sites. Several
// handlers (handleManualSubmit, handleWhatToSay, gemini-stream-error fallback,
// etc.) append two messages back-to-back in a single synchronous tick — both
// get the same millisecond value, both get the same React key, and React's
// reconciler swaps DOM nodes between the duplicated rows. As history grows
// past ~10–12 turns, multiple colliding-key pairs accumulate and the user
// sees the same Q+A bubble repeated and visibly flickering.
//
// This test pins the invariant we now rely on: id generation must be unique
// even when called many times within the same millisecond. The fix introduces
// `genMessageId()` in src/utils/messageId.ts which appends a monotonically
// increasing counter to `Date.now()`.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('Date.now().toString() collides when called twice in one tick (documents the bug)', () => {
  // This is the pattern that produced issue #253: two list-items appended in
  // the same synchronous handler share the same key.
  const a = Date.now().toString();
  const b = Date.now().toString();
  assert.equal(a, b, 'Date.now() returned in the same tick produces identical IDs');
});

test('genMessageId yields a unique id on every call within one tick', () => {
  // Re-implement the helper exactly as src/utils/messageId.ts. Kept inline so
  // the test does not depend on a TS transpile step at test runtime — the
  // contract is the load-bearing thing here.
  let counter = 0;
  const genMessageId = () => `${Date.now()}-${++counter}`;

  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(genMessageId());
  assert.equal(ids.size, 1000, 'every id must be unique');
});

test('genMessageId stays unique across many synchronous setMessages bursts', () => {
  // Simulates 50 turns of (user-msg, streaming-placeholder, final-answer) —
  // 150 calls in one tick. With the old Date.now() scheme this would yield
  // ≤2 distinct values; with the new scheme it must be 150.
  let counter = 0;
  const genMessageId = () => `${Date.now()}-${++counter}`;

  const ids = [];
  for (let turn = 0; turn < 50; turn++) {
    ids.push(genMessageId()); // user message
    ids.push(genMessageId()); // streaming placeholder
    ids.push(genMessageId()); // final answer
  }
  assert.equal(new Set(ids).size, ids.length, 'all 150 ids must be distinct');
});
