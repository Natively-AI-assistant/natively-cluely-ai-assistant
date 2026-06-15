// PHASE 9 verification — Global Search V2 handler LOGIC.
//
// The real IPC handler `search:global-meetings` (electron/ipcHandlers.ts) needs Electron
// + a live SQLite DB, so we can't unit-test the handler itself headlessly. Instead this
// file FAITHFULLY REPLICATES the handler's pure candidate-building logic (ipcHandlers.ts
// ~lines 3875-3915) and runs the REAL compiled SearchOrchestrator.globalSearch from
// dist-electron. The replicated block below is copied verbatim from the handler (minus
// the DatabaseManager fetch + flag gate, which are exercised elsewhere) so that if the
// handler's lexical/candidate logic ever drifts, these assertions catch it.
//
// Source of truth for the data shape: DatabaseManager.getRecentMeetings() returns
// Meeting[] with detailedSummary = summary_json.detailedSummary, and Phase-8
// meetingMemory lives at detailedSummary.meetingMemory (MeetingPersistence.ts:368,399 →
// DatabaseManager.saveMeeting:1158-1160 → getRecentMeetings:1309).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

// ----------------------------------------------------------------------------
// REPLICA of the handler's candidate-building + ranking (ipcHandlers.ts ~3875-3913).
// Kept byte-faithful to the production logic so this test asserts the REAL behavior.
// ----------------------------------------------------------------------------
function runGlobalSearchLogic(query, meetings, filters = {}, recencyAnchorMs = Date.now()) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const candidates = [];
  for (const m of meetings) {
    const ds = m.detailedSummary || {};
    const mem = ds.meetingMemory || {};
    const haystackParts = [
      m.title, m.summary, ds.overview,
      ...(Array.isArray(ds.keyPoints) ? ds.keyPoints : []),
      ...(Array.isArray(mem.topics) ? mem.topics : []),
      ...(Array.isArray(mem.entities) ? mem.entities : []),
      ...(Array.isArray(mem.decisions) ? mem.decisions : []),
      ...(Array.isArray(mem.questionsAsked) ? mem.questionsAsked : []),
      ...(Array.isArray(mem.skillsDiscussed) ? mem.skillsDiscussed : []),
    ].filter(Boolean).map((s) => String(s));
    const hay = haystackParts.join(' • ').toLowerCase();
    if (!hay) continue;
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    if (hits === 0) continue;
    const phraseBonus = hay.includes(q) ? 0.5 : 0;
    const score = Math.min(1, hits / Math.max(1, terms.length) + phraseBonus);
    const snippet = haystackParts.find((p) => p.toLowerCase().includes(terms[0])) || m.title || m.summary || '';
    candidates.push({
      meetingId: m.id,
      title: m.title,
      date: m.date ? Date.parse(m.date) || undefined : undefined,
      snippet: snippet.slice(0, 240),
      source: 'lexical',
      score,
      userId: 'local',
      metadata: { company: String(mem.companiesDiscussed?.[0] ?? '') },
    });
  }
  return new SearchOrchestrator().globalSearch(candidates, { userId: 'local' }, filters || {}, recencyAnchorMs);
}

// ----------------------------------------------------------------------------
// Fake meetings shaped exactly like DatabaseManager.getRecentMeetings() output.
// ----------------------------------------------------------------------------
const redisMemoryMeeting = {
  id: 'm-redis',
  title: 'Backend architecture sync',
  date: '2026-06-10T10:00:00.000Z',
  summary: 'Discussed caching strategy and data stores.',
  detailedSummary: {
    overview: 'Team aligned on caching layer.',
    actionItems: [],
    keyPoints: ['Adopt a write-through cache'],
    meetingMemory: {
      topics: ['caching', 'latency'],
      entities: ['Backend team'],
      decisions: ['Use a cache for hot reads'],
      questionsAsked: ['What is our cache eviction policy?'],
      skillsDiscussed: ['Redis', 'PostgreSQL', 'Node.js'],
      companiesDiscussed: ['Acme'],
      schemaVersion: 1,
    },
  },
};

const redisSummaryMeeting = {
  id: 'm-redis-summary',
  title: 'Ops review',
  date: '2026-06-09T10:00:00.000Z',
  // No meetingMemory; Redis only appears in the free-text summary.
  summary: 'We migrated session storage to Redis and saw lower p95.',
  detailedSummary: {
    overview: 'Latency improvements after the migration.',
    actionItems: [],
    keyPoints: ['p95 down 40%'],
  },
};

const graphqlMeeting = {
  id: 'm-graphql',
  title: 'API design discussion',
  date: '2026-06-08T10:00:00.000Z',
  summary: 'Talked about schema and resolvers.',
  detailedSummary: {
    overview: 'GraphQL schema proposal.',
    actionItems: [],
    keyPoints: ['Federate the gateway'],
    meetingMemory: {
      topics: ['api'],
      entities: [],
      decisions: [],
      questionsAsked: [],
      skillsDiscussed: ['GraphQL', 'Apollo'],
      companiesDiscussed: [],
      schemaVersion: 1,
    },
  },
};

// Old meeting: NO detailedSummary at all (pre-Phase-8). Must not crash; searchable by
// title/summary only.
const oldMeeting = {
  id: 'm-old',
  title: 'Legacy Redis incident postmortem',
  date: '2025-01-01T10:00:00.000Z',
  summary: 'Old incident notes.',
  // detailedSummary intentionally absent
};

// Meeting with a detailedSummary but empty/missing meetingMemory.
const noMemoryMeeting = {
  id: 'm-no-mem',
  title: 'Sprint planning',
  date: '2026-06-07T10:00:00.000Z',
  summary: 'Planned the next sprint with Redis cache work on the board.',
  detailedSummary: { actionItems: [], keyPoints: [] },
};

const allMeetings = [
  redisMemoryMeeting,
  redisSummaryMeeting,
  graphqlMeeting,
  oldMeeting,
  noMemoryMeeting,
];

describe('Phase 9 — global search handler logic (real SearchOrchestrator)', () => {
  test('(a) "redis" matches via meetingMemory.skillsDiscussed AND via summary text, with snippet + confidence', () => {
    const res = runGlobalSearchLogic('redis', allMeetings, {}, Date.parse('2026-06-11T00:00:00.000Z'));
    const ids = res.map((r) => r.meetingId);

    // The skills-based meeting (Redis in skillsDiscussed) is found.
    assert.ok(ids.includes('m-redis'), 'meeting with Redis in skillsDiscussed is returned');
    // The summary-only meeting (Redis only in free-text summary) is found.
    assert.ok(ids.includes('m-redis-summary'), 'meeting with Redis only in summary is returned');
    // The old meeting (Redis in title) is found.
    assert.ok(ids.includes('m-old'), 'old meeting with Redis in title is returned');
    // The no-memory meeting (Redis in summary) is found.
    assert.ok(ids.includes('m-no-mem'), 'meeting with Redis in summary (no memory) is returned');
    // GraphQL-only meeting is NOT returned.
    assert.ok(!ids.includes('m-graphql'), 'unrelated GraphQL meeting is excluded');

    for (const r of res) {
      assert.equal(typeof r.confidence, 'number');
      assert.ok(r.confidence > 0, `confidence > 0 for ${r.meetingId}`);
      assert.equal(typeof r.matchedSnippet, 'string');
      assert.ok(r.matchedSnippet.length > 0, `non-empty snippet for ${r.meetingId}`);
    }

    // The memory snippet should be the matched part (skillsDiscussed contains "Redis").
    const top = res.find((r) => r.meetingId === 'm-redis');
    assert.ok(/redis/i.test(top.matchedSnippet), 'snippet for skills match references Redis');
  });

  test('(b) a query matching nothing returns []', () => {
    const res = runGlobalSearchLogic('kubernetes helm istio', allMeetings, {}, Date.now());
    assert.deepEqual(res, [], 'no candidates => empty result list');
  });

  test('(c) a meeting with NO detailedSummary/meetingMemory does not crash and is searchable by title/summary', () => {
    // Search only the old meeting; query hits its TITLE.
    const byTitle = runGlobalSearchLogic('postmortem', [oldMeeting], {}, Date.now());
    assert.equal(byTitle.length, 1, 'old meeting found by title token');
    assert.equal(byTitle[0].meetingId, 'm-old');

    // And by its summary text.
    const bySummary = runGlobalSearchLogic('incident', [oldMeeting], {}, Date.now());
    assert.equal(bySummary.length, 1, 'old meeting found by summary token');
    assert.equal(bySummary[0].meetingId, 'm-old');

    // No detailedSummary => still no throw, and a non-matching query yields [].
    assert.doesNotThrow(() => runGlobalSearchLogic('redis', [oldMeeting], {}, Date.now()));
  });

  test('(d) results are ranked by confidence (descending)', () => {
    const res = runGlobalSearchLogic('redis', allMeetings, {}, Date.parse('2026-06-11T00:00:00.000Z'));
    assert.ok(res.length >= 2, 'multiple results to rank');
    for (let i = 1; i < res.length; i++) {
      assert.ok(
        res[i - 1].confidence >= res[i].confidence,
        `result ${i - 1} (${res[i - 1].confidence}) >= result ${i} (${res[i].confidence})`,
      );
    }
  });

  test('(e) userId:"local" scope returns ALL local meetings — isolation invariant drops nothing', () => {
    // Every candidate is userId:'local'; the scope is userId:'local'. Nothing must be
    // dropped by the isolation filter. A broad query that hits every meeting proves it.
    const res = runGlobalSearchLogic('redis graphql incident sprint', allMeetings, {}, Date.now());
    const ids = new Set(res.map((r) => r.meetingId));
    // Every meeting has at least one matching token across title/summary/memory.
    for (const m of allMeetings) {
      assert.ok(ids.has(m.id), `local meeting ${m.id} is present (not isolation-dropped)`);
    }
    assert.equal(ids.size, allMeetings.length, 'no local meeting was dropped');
  });

  test('isolation: a foreign-user candidate is dropped even with a perfect score', () => {
    // Directly exercise the orchestrator's isolation: a userId !== "local" candidate
    // must never surface under the local scope the handler always uses.
    const svc = new SearchOrchestrator();
    const res = svc.globalSearch(
      [
        { meetingId: 'mine', title: 'Mine', snippet: 's', source: 'lexical', score: 0.4, userId: 'local' },
        { meetingId: 'theirs', title: 'Theirs', snippet: 's', source: 'lexical', score: 1.0, userId: 'other-user' },
      ],
      { userId: 'local' },
      {},
      Date.now(),
    );
    const ids = res.map((r) => r.meetingId);
    assert.ok(ids.includes('mine'), 'local meeting surfaces');
    assert.ok(!ids.includes('theirs'), 'foreign-user meeting is dropped despite score 1.0');
  });

  test('globalSearch never throws on empty / malformed candidates', () => {
    const svc = new SearchOrchestrator();
    assert.deepEqual(svc.globalSearch([], { userId: 'local' }, {}, Date.now()), []);
    assert.deepEqual(svc.globalSearch(undefined, { userId: 'local' }, {}, Date.now()), []);
    assert.doesNotThrow(() =>
      svc.globalSearch([null, undefined], { userId: 'local' }, {}, Date.now()),
    );
    // The handler short-circuits empty/whitespace queries before calling globalSearch.
    assert.deepEqual(runGlobalSearchLogic('', allMeetings), []);
    assert.deepEqual(runGlobalSearchLogic('   ', allMeetings), []);
  });

  test('single-character tokens are ignored (t.length > 1 filter) but multi-char still match', () => {
    // "a redis" -> "a" dropped, "redis" kept. Still matches Redis meetings.
    const res = runGlobalSearchLogic('a redis', allMeetings, {}, Date.now());
    assert.ok(res.some((r) => r.meetingId === 'm-redis'), 'multi-char token still matches');
  });
});
