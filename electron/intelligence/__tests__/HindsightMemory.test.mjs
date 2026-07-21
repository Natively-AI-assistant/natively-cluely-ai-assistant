// PHASE 16 — Hindsight long-term memory adapter. Covers memory-provider, tag-builder,
// adapter (mock client), timeout, disabled-fallback, isolation, retain-queue.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NoopMemoryProvider } from '../../../dist-electron/electron/intelligence/memory/MemoryProvider.js';
import { HindsightTagBuilder } from '../../../dist-electron/electron/intelligence/memory/HindsightTagBuilder.js';
import { HindsightClientAdapter } from '../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js';
import { HindsightRetainQueue } from '../../../dist-electron/electron/intelligence/memory/HindsightRetainQueue.js';
import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('NoopMemoryProvider (disabled default)', () => {
  test('retain is a no-op, recall is empty, never throws', async () => {
    const p = new NoopMemoryProvider();
    assert.equal(p.enabled, false);
    assert.doesNotThrow(() => p.retain({ content: 'x', scope: { userId: 'a' }, source: 'chat_history' }));
    assert.deepEqual(await p.recall('q', { userId: 'a' }, { timeoutMs: 100 }), []);
  });
});

describe('HindsightTagBuilder — isolation by bank + strict tags', () => {
  const tb = new HindsightTagBuilder();
  test('bank is per-org when org present, else per-user', () => {
    assert.equal(tb.bankId({ userId: 'alice', orgId: 'acme' }), 'org_acme');
    assert.equal(tb.bankId({ userId: 'alice' }), 'user_alice');
  });
  test('required tags always include user + org + visibility:private', () => {
    const tags = tb.requiredTags({ userId: 'alice', orgId: 'acme' });
    assert.ok(tags.includes('user:alice'));
    assert.ok(tags.includes('org:acme'));
    assert.ok(tags.includes('visibility:private'));
  });
  test('personal scope tags org:personal (not untagged)', () => {
    assert.ok(tb.requiredTags({ userId: 'alice' }).includes('org:personal'));
  });
  test('retain tags include source + context tags', () => {
    const tags = tb.retainTags({ userId: 'a', meetingId: 'm1', courseId: 'OS' }, 'meeting_summary', 'sales');
    assert.ok(tags.includes('source:meeting_summary'));
    assert.ok(tags.includes('mode:sales'));
    assert.ok(tags.includes('meeting:m1'));
    assert.ok(tags.includes('course:os'));
  });
  test('participant ids are hashed, never raw', () => {
    const tags = tb.retainTags({ userId: 'a', participantHash: 'john.doe@example.com' }, 'meeting_transcript');
    assert.ok(!tags.some(t => t.includes('john.doe')));
    assert.ok(tags.some(t => t.startsWith('participant:')));
  });
});

describe('HindsightRetainQueue — async, non-blocking', () => {
  test('enqueue returns immediately and drains in background', async () => {
    const seen = [];
    const q = new HindsightRetainQueue(async (item) => { await sleep(5); seen.push(item.content); });
    q.enqueue({ content: 'a', scope: { userId: 'u' }, source: 'chat_history' });
    q.enqueue({ content: 'b', scope: { userId: 'u' }, source: 'chat_history' });
    assert.ok(seen.length <= 2); // not necessarily done yet — non-blocking
    await sleep(40);
    assert.deepEqual(seen, ['a', 'b']);
  });
  test('a throwing worker never stops the queue', async () => {
    const seen = [];
    const q = new HindsightRetainQueue(async (item) => { if (item.content === 'bad') throw new Error('x'); seen.push(item.content); });
    q.enqueue({ content: 'bad', scope: { userId: 'u' }, source: 'chat_history' });
    q.enqueue({ content: 'good', scope: { userId: 'u' }, source: 'chat_history' });
    await sleep(30);
    assert.deepEqual(seen, ['good']);
  });
});

describe('HindsightClientAdapter — mock client', () => {
  function mockClient(recallResults = []) {
    const calls = { retain: [], recall: [] };
    return {
      calls,
      retain: async (bankId, content, options) => { calls.retain.push({ bankId, content, options }); },
      recall: async (bankId, query, options) => { calls.recall.push({ bankId, query, options }); return { results: recallResults }; },
    };
  }

  test('retain enqueues with bank + strict tags', async () => {
    const client = mockClient();
    const a = new HindsightClientAdapter({ baseUrl: 'http://localhost:8888', defaultBank: 'd' }, client);
    assert.equal(a.enabled, true);
    a.retain({ content: 'We discussed Redis.', scope: { userId: 'alice', orgId: 'acme', meetingId: 'm1' }, source: 'meeting_summary', mode: 'sales' });
    await a.flush();
    assert.equal(client.calls.retain.length, 1);
    assert.equal(client.calls.retain[0].bankId, 'org_acme');
    assert.ok(client.calls.retain[0].options.tags.includes('user:alice'));
    assert.equal(client.calls.retain[0].options.async, true);
  });

  test('recall filters with tags + all_strict', async () => {
    const client = mockClient([{ text: 'Redis was discussed', score: 0.9 }]);
    const a = new HindsightClientAdapter({ baseUrl: 'http://x' }, client);
    const res = await a.recall('what about redis?', { userId: 'alice' }, { timeoutMs: 500 });
    assert.equal(res.length, 1);
    assert.match(res[0].text, /Redis/);
    assert.equal(client.calls.recall[0].options.tagsMatch, 'all_strict');
    assert.ok(client.calls.recall[0].options.tags.includes('user:alice'));
  });

  test('TIMEOUT: a slow recall returns [] within the budget', async () => {
    const slowClient = { retain: async () => {}, recall: () => new Promise((r) => setTimeout(() => r({ results: [{ text: 'late' }] }), 5000)) };
    const a = new HindsightClientAdapter({ baseUrl: 'http://x' }, slowClient);
    const t0 = Date.now();
    const res = await a.recall('q', { userId: 'a' }, { timeoutMs: 100 });
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(res, []);
  });

  test('a throwing client never breaks recall', async () => {
    const badClient = { retain: async () => {}, recall: async () => { throw new Error('boom'); } };
    const a = new HindsightClientAdapter({ baseUrl: 'http://x' }, badClient);
    assert.deepEqual(await a.recall('q', { userId: 'a' }, { timeoutMs: 200 }), []);
  });
});

describe('LongTermMemoryService — disabled fallback + works-without-hindsight', () => {
  test('defaults to Noop (memory disabled) — app works', async () => {
    const svc = new LongTermMemoryService();
    assert.equal(svc.enabled, false);
    assert.equal(svc.providerName, 'noop');
    svc.retainMeetingSummary('m1', 'summary', { userId: 'a' });
    assert.deepEqual(await svc.recallRelevantMemory('q', { userId: 'a' }), []);
  });

  test('fromFlags returns Noop when the flag is off (default)', () => {
    const svc = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: 'http://x' } });
    assert.equal(svc.enabled, false); // hindsight_memory flag defaults OFF
  });

  test('fromFlags uses an injected provider override', async () => {
    let retained = 0;
    const fake = { name: 'fake', enabled: true, retain: () => { retained++; }, recall: async () => [{ text: 'hit' }], flush: async () => {} };
    const svc = LongTermMemoryService.fromFlags({}, fake);
    assert.equal(svc.enabled, true);
    svc.retainConversationTurn('s1', 'turn', { userId: 'a' });
    assert.equal(retained, 1);
    const r = await svc.recallRelevantMemory('q', { userId: 'a' });
    assert.equal(r[0].text, 'hit');
  });

  test('typed retain helpers never throw', () => {
    const svc = new LongTermMemoryService();
    assert.doesNotThrow(() => {
      svc.retainMeetingTranscript('m', 't', { userId: 'a' });
      svc.retainLectureSummary('l', 's', { userId: 'a' }, 'OS');
      svc.retainLectureDiagram('l', 'sequenceDiagram', { userId: 'a' });
      svc.retainUserFeedback('good', { userId: 'a' });
    });
  });
});
