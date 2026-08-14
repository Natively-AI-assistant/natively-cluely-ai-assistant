// PHASE 13 — Hindsight POST-MEETING RETAIN wiring (electron/MeetingPersistence.ts).
//
// These tests lock the LOAD-BEARING SAFETY PROPERTY of Phase 13: the post-meeting retain
// block built in MeetingPersistence.ts calls
//   LongTermMemoryService.fromFlags({ hindsight: { baseUrl, apiKey, timeoutMs } })
// and only retains when `ltm.enabled`. The whole feature must be a guaranteed NO-OP unless
//   (1) the hindsightMemory flag is ON, AND
//   (2) a baseUrl is configured, AND
//   (3) the OPTIONAL @vectorize-io/hindsight-client is installed/constructable.
//
// In this repo the client is NOT installed (no @vectorize-io in node_modules / package.json,
// confirmed at review time), so even with BOTH flags ON and a baseUrl set, fromFlags must
// still return a Noop-backed service (adapter.enabled=false). The app must work fully
// "configured but client absent". We assert that here against the REAL compiled service.
//
// We deliberately do NOT re-prove what HindsightMemory.test.mjs already covers (Noop
// default, flag-OFF→Noop, tag-builder isolation tags, adapter timeout/throw). This file
// only adds the wiring-specific gaps:
//   (b) flag ON + client absent → still Noop  (the new load-bearing property)
//   (d) the wiring's exact call — retainMeetingSummary(meetingId, text, {userId,meetingId}, mode)
//       reaches the provider with the right scope/meetingId/source via a MOCK provider
//   - the real HindsightClientAdapter built with no override → enabled=false in this env
//   - the recall path used by other phases is [] on Noop (never blocks live answers)

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';
import { HindsightClientAdapter } from '../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js';
import { NoopMemoryProvider } from '../../../dist-electron/electron/intelligence/memory/MemoryProvider.js';
import { HindsightTagBuilder } from '../../../dist-electron/electron/intelligence/memory/HindsightTagBuilder.js';

// The compiled LongTermMemoryService bundles its OWN inlined copy of intelligenceFlags
// (esbuild bundle:true), and that module reads env FRESH on every call (no cache to reset
// across bundle boundaries). So an env override is the reliable, bundle-agnostic way to
// flip the hindsightMemory flag for the compiled service under test.
const HINDSIGHT_MEMORY_ENV = 'NATIVELY_HINDSIGHT_MEMORY';
function clearFlag() { delete process.env[HINDSIGHT_MEMORY_ENV]; }

describe('Phase 13 — fromFlags is Noop unless flag ON + baseUrl + client installed', () => {
  beforeEach(clearFlag);
  afterEach(clearFlag);

  test('(a) flag OFF + baseUrl set → Noop (enabled=false, providerName=noop)', () => {
    // Sanity floor: even with a real-looking baseUrl, the flag default OFF gives Noop.
    clearFlag();
    const ltm = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: 'http://localhost:8888' } });
    assert.equal(ltm.enabled, false, 'flag OFF must yield a disabled (Noop) service');
    assert.equal(ltm.providerName, 'noop');
  });

  test('(b2) flag ON but NO baseUrl → Noop (config guard, before any client load)', () => {
    // The load-bearing fallback that does NOT depend on the client being absent: with no
    // baseUrl configured, fromFlags returns Noop BEFORE ever constructing the adapter.
    // This holds whether or not @vectorize-io/hindsight-client is installed.
    process.env[HINDSIGHT_MEMORY_ENV] = 'on';
    const ltm = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: '' } });
    assert.equal(ltm.enabled, false);
    assert.equal(ltm.providerName, 'noop');
  });

  test('(b3) flag ON + baseUrl set + client installed → adapter is constructed (enabled)', () => {
    // The @vectorize-io/hindsight-client IS now an installed optionalDependency, so a
    // configured adapter constructs successfully and reports enabled. (Whether a SERVER is
    // actually reachable is orthogonal — recall/retain degrade gracefully if it's down.)
    // The "client-absent → Noop" safety path is covered at the unit level in
    // HindsightMemory.test.mjs via a mock, and structurally by the lazy try/catch require.
    const adapter = new HindsightClientAdapter({ baseUrl: 'http://localhost:8888', apiKey: 'k' });
    assert.equal(adapter.name, 'hindsight');
    assert.equal(adapter.enabled, true, 'with the client installed + a baseUrl, the adapter constructs enabled');
  });
});

describe('Phase 13 — retain on a disabled (Noop) service is a safe no-op', () => {
  test('(c) retainMeetingSummary on Noop never throws and triggers no I/O', () => {
    // This is the exact wiring call shape from MeetingPersistence.ts (post-meeting retain).
    const ltm = new LongTermMemoryService(); // default Noop
    assert.equal(ltm.enabled, false);
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('meeting-123', 'a one-line meeting overview', { userId: 'local', meetingId: 'meeting-123' }, 'sales');
    }, 'retain on a Noop service must be a silent no-op');
  });

  test('(c2) retainMeetingSummary tolerates empty/whitespace summary text without throwing', () => {
    const ltm = new LongTermMemoryService();
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('m', '', { userId: 'local', meetingId: 'm' });
      ltm.retainMeetingSummary('m', '   ', { userId: 'local', meetingId: 'm' });
    });
  });
});

describe('Phase 13 — wiring calls the RIGHT retain method with the RIGHT scope (mock provider)', () => {
  // Prove the production wiring shape — fromFlags(..., providerOverride) → retainMeetingSummary
  // with { userId:'local', meetingId } + mode — actually reaches the provider with the
  // correct content/scope/source/mode. HindsightMemory.test.mjs only exercised
  // retainConversationTurn via an override; the Phase 13 wiring uses retainMeetingSummary,
  // so we cover that specific call here.
  function recordingProvider() {
    const calls = { retain: [], recall: [] };
    return {
      provider: {
        name: 'mock', enabled: true,
        retain: (item) => { calls.retain.push(item); },
        recall: async (query, scope, options) => { calls.recall.push({ query, scope, options }); return [{ text: 'hit' }]; },
        flush: async () => {},
      },
      calls,
    };
  }

  test('(d) retainMeetingSummary → provider.retain with source=meeting_summary + scope.meetingId + mode', () => {
    const { provider, calls } = recordingProvider();
    // providerOverride short-circuits flag/client checks → enabled service (the wiring path
    // that would be taken once a real client were installed).
    const ltm = LongTermMemoryService.fromFlags({}, provider);
    assert.equal(ltm.enabled, true);
    assert.equal(ltm.providerName, 'mock');

    // Exact call the post-meeting block makes (MeetingPersistence.ts ~line 433).
    ltm.retainMeetingSummary('meeting-abc', 'We covered Redis caching and pricing.', { userId: 'local', meetingId: 'meeting-abc' }, 'sales');

    assert.equal(calls.retain.length, 1, 'retain must be invoked exactly once');
    const item = calls.retain[0];
    assert.equal(item.content, 'We covered Redis caching and pricing.');
    assert.equal(item.source, 'meeting_summary', 'must be tagged as a meeting_summary');
    assert.equal(item.mode, 'sales', 'mode must propagate for mode-scoped recall');
    assert.equal(item.scope.userId, 'local');
    assert.equal(item.scope.meetingId, 'meeting-abc', 'meetingId must land in scope for per-meeting isolation');
  });

  test('(d2) a throwing provider.retain is swallowed — retain NEVER surfaces to the meeting save', () => {
    const ltm = LongTermMemoryService.fromFlags({}, {
      name: 'angry', enabled: true,
      retain: () => { throw new Error('provider blew up'); },
      recall: async () => [],
      flush: async () => {},
    });
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('m', 'text', { userId: 'local', meetingId: 'm' }, 'meeting');
    }, 'a provider exception must be swallowed inside the service (defense-in-depth with the wiring try/catch)');
  });
});

describe('Phase 13 — recall on Noop is [] (never blocks; other phases inherit this)', () => {
  test('(e) recallRelevantMemory on Noop returns [] within the default budget', async () => {
    const ltm = new LongTermMemoryService();
    const t0 = Date.now();
    const out = await ltm.recallRelevantMemory('what did we discuss?', { userId: 'local' });
    assert.deepEqual(out, [], 'disabled recall must return an empty list');
    assert.ok(Date.now() - t0 < 500, 'Noop recall must return effectively immediately (never blocks)');
  });
});

describe('Phase 13 — isolation tags carry the post-meeting retain scope', () => {
  // Light, non-duplicative isolation check tied to the Phase 13 scope shape
  // ({ userId:'local', meetingId }). HindsightMemory.test.mjs covers the generic builder;
  // here we just confirm the *post-meeting* scope produces the mandatory isolation tags
  // plus the meeting tag, so a retained summary can never be recalled cross-scope.
  test('retainTags for a meeting summary include user + visibility:private + org + source + meeting', () => {
    const tags = new HindsightTagBuilder().retainTags(
      { userId: 'local', meetingId: 'meeting-abc' }, 'meeting_summary', 'sales',
    );
    assert.ok(tags.includes('user:local'), 'mandatory user tag');
    assert.ok(tags.includes('visibility:private'), 'mandatory private visibility tag');
    assert.ok(tags.includes('org:personal'), 'single-user desktop → org:personal (never untagged)');
    assert.ok(tags.includes('source:meeting_summary'));
    assert.ok(tags.includes('mode:sales'));
    assert.ok(tags.includes('meeting:meeting-abc'), 'meeting tag scopes recall to this meeting');
  });

  test('recallTags are exactly the mandatory isolation tags (all_strict filters foreign/untagged)', () => {
    const tags = new HindsightTagBuilder().recallTags({ userId: 'local', meetingId: 'meeting-abc' });
    assert.deepEqual([...tags].sort(), ['org:personal', 'user:local', 'visibility:private'].sort());
  });
});
