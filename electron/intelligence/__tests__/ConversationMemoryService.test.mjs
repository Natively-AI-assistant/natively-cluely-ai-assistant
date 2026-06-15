// PHASE 13 — Conversation Memory: same-session local recall, rolling summary,
// cross-session via optional provider with strict timeout, isolation, never-throw.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemoryService } from '../../../dist-electron/electron/intelligence/ConversationMemoryService.js';

function seed(svc, sessionId) {
  svc.record({ sessionId, userMessage: 'Tell me about the Redis caching design', assistantAnswer: 'We cache the hot path in Redis with a 60s TTL.', mode: 'technical-interview', timestamp: 1000 });
  svc.record({ sessionId, userMessage: 'What about the database?', assistantAnswer: 'Postgres with read replicas for scale.', mode: 'technical-interview', timestamp: 2000 });
}

describe('ConversationMemoryService — same-session (local first)', () => {
  test('records and returns recent turns', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    const recent = svc.getRecentTurns('s1', 5);
    assert.equal(recent.length, 2);
    assert.match(recent[1].userMessage, /database/);
  });

  test('rolling summary is extractive (no LLM) and bounded', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    const sum = svc.getSessionSummary('s1');
    assert.match(sum, /Redis/);
    assert.match(sum, /database|Postgres/);
  });

  test('getLastAssistantAnswer returns the previous suggestion', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    assert.match(svc.getLastAssistantAnswer('s1'), /Postgres/);
  });

  test('resolveSameSession matches a follow-up to the relevant prior turn', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    const t = svc.resolveSameSession('s1', 'can you expand on the Redis part?');
    assert.ok(t);
    assert.match(t.userMessage, /Redis/);
  });

  test('bare follow-up with no overlap resolves to the most recent turn', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    const t = svc.resolveSameSession('s1', 'and that?');
    assert.ok(t);
    assert.match(t.userMessage, /database/);
  });

  test('entities are auto-extracted per turn', () => {
    const svc = new ConversationMemoryService();
    const stored = svc.record({ sessionId: 's1', userMessage: 'Explain Kafka partitions', assistantAnswer: 'Kafka splits topics into partitions.', timestamp: 1 });
    assert.ok(stored.entities.some(e => /Kafka/i.test(e)));
  });
});

describe('ConversationMemoryService — isolation', () => {
  test('sessions are isolated from each other', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 'alice-session');
    svc.record({ sessionId: 'bob-session', userMessage: 'Bob question', assistantAnswer: 'Bob answer', timestamp: 1 });
    const bob = svc.getRecentTurns('bob-session');
    assert.equal(bob.length, 1);
    assert.doesNotMatch(JSON.stringify(bob), /Redis|Postgres/);
  });

  test('clearSession wipes only that session', () => {
    const svc = new ConversationMemoryService();
    seed(svc, 's1');
    svc.record({ sessionId: 's2', userMessage: 'x', assistantAnswer: 'y', timestamp: 1 });
    svc.clearSession('s1');
    assert.equal(svc.getRecentTurns('s1').length, 0);
    assert.equal(svc.getRecentTurns('s2').length, 1);
  });
});

describe('ConversationMemoryService — cross-session (optional long-term)', () => {
  test('returns [] when no provider (memory disabled) — never blocks', async () => {
    const svc = new ConversationMemoryService();
    const r = await svc.recallCrossSession('what did we discuss last time?', { userId: 'alice' });
    assert.deepEqual(r, []);
  });

  test('delegates to the provider when present', async () => {
    const provider = { recall: async () => [{ text: 'Last time we discussed Redis.', score: 0.9 }] };
    const svc = new ConversationMemoryService(provider);
    const r = await svc.recallCrossSession('what did we discuss?', { userId: 'alice' });
    assert.equal(r.length, 1);
    assert.match(r[0].text, /Redis/);
  });

  test('a slow provider is cut off by the strict timeout (returns [])', async () => {
    const provider = { recall: () => new Promise(res => setTimeout(() => res([{ text: 'too slow' }]), 5000)) };
    const svc = new ConversationMemoryService(provider);
    const t0 = Date.now();
    const r = await svc.recallCrossSession('q', { userId: 'alice' }, 100);
    assert.ok(Date.now() - t0 < 1000, 'must return within the timeout, not wait for the provider');
    assert.deepEqual(r, []);
  });

  test('a throwing provider never breaks the caller', async () => {
    const provider = { recall: async () => { throw new Error('boom'); } };
    const svc = new ConversationMemoryService(provider);
    const r = await svc.recallCrossSession('q', { userId: 'alice' }, 200);
    assert.deepEqual(r, []);
  });
});
