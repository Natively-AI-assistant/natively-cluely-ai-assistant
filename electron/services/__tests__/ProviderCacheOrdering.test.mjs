// electron/services/__tests__/ProviderCacheOrdering.test.mjs
// Locks in the cache-ordering invariant for Ollama + custom (OpenAI-compatible)
// providers: the static system prompt MUST lead as messages[0] and ALL
// per-request content (context, transcript, user question) MUST stay in the
// trailing user message. Putting per-request data in the system message busts
// prefix/KV cache reuse every turn.
// Replicates the message-assembly logic in streamWithOllama / streamWithCustom.
// Run: node --test electron/services/__tests__/ProviderCacheOrdering.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the message assembly in streamWithOllama and streamWithCustom (identical shape).
function buildMessages(systemPrompt, context, message) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  let userContent = message;
  if (context) userContent = `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`;
  messages.push({ role: 'user', content: userContent });
  return messages;
}

describe('provider cache ordering invariant', () => {
  test('system prompt is messages[0] when present', () => {
    const m = buildMessages('STATIC SYSTEM', 'ctx', 'q');
    assert.strictEqual(m[0].role, 'system');
    assert.strictEqual(m[0].content, 'STATIC SYSTEM');
  });

  test('per-request content lives ONLY in the trailing user message', () => {
    const m = buildMessages('STATIC SYSTEM', 'DYNAMIC CONTEXT', 'DYNAMIC QUESTION');
    // system message must contain none of the per-request content
    assert.doesNotMatch(m[0].content, /DYNAMIC CONTEXT/);
    assert.doesNotMatch(m[0].content, /DYNAMIC QUESTION/);
    // user message carries both
    const user = m[m.length - 1];
    assert.strictEqual(user.role, 'user');
    assert.match(user.content, /DYNAMIC CONTEXT/);
    assert.match(user.content, /DYNAMIC QUESTION/);
  });

  test('system prompt is byte-stable across turns with different questions', () => {
    const a = buildMessages('STATIC SYSTEM', 'ctxA', 'questionA');
    const b = buildMessages('STATIC SYSTEM', 'ctxB', 'questionB');
    // The cacheable prefix (system message) is identical → KV/prefix cache reusable
    assert.strictEqual(a[0].content, b[0].content);
    // The user messages differ → only the uncached suffix changes
    assert.notStrictEqual(a[a.length - 1].content, b[b.length - 1].content);
  });

  test('no context → user message is just the question (no empty CONTEXT wrapper)', () => {
    const m = buildMessages('STATIC SYSTEM', undefined, 'just the question');
    assert.strictEqual(m[m.length - 1].content, 'just the question');
  });

  test('no system prompt → only the user message, still cache-shaped', () => {
    const m = buildMessages('', 'ctx', 'q');
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].role, 'user');
  });

  test('changing context does NOT alter the system prefix', () => {
    const base = buildMessages('SYS', 'ctx1', 'q')[0].content;
    const other = buildMessages('SYS', 'a totally different and much longer context block', 'q')[0].content;
    assert.strictEqual(base, other);
  });
});
