// resolveMeetingEvidence (issue #552): the ONE builder of meeting evidence for
// the V3 surfaces. Before it, manual chat resolved the meeting id through a
// method that did not exist and never built a meeting port, and what-to-answer
// scoped its port by a metadata id no normal meeting sets — so the JIT
// embeddings were never evidence anywhere.
//
// Imports compiled output: run `npm run build:electron` first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (rel) => import(pathToFileURL(path.join(base, rel)).href);
const { resolveMeetingEvidence } = await load('retrieval/meeting-evidence.js');
const { LIVE_TRANSCRIPT_SOURCE_ID } = await load('retrieval/live-transcript-port.js');
const { decide } = await load('orchestration/orchestrator.js');

const LIVE_ID = 'live-meeting-current';
const TEAM_MEET_SOURCES = ['MEETING_TRANSCRIPT', 'REFERENCE_FILE', 'SCREEN_CONTEXT', 'CONVERSATION_STATE'];
const t0 = 1_700_000_000_000;
const segments = [
  { speaker: 'system', text: 'we moved the elasticsearch relocation window to two to four utc', timestamp: t0, final: true },
  { speaker: 'user', text: 'and the snowflake cap is nine hundred credits now', timestamp: t0 + 8000, final: true },
];

// A retriever that returns one JIT chunk stored under the LIVE id — the shape
// VectorStore hands back (meetingId/text/similarity/chunkIndex).
const jitRetriever = (calls = []) => ({
  retrieve: async (query, opts) => {
    calls.push(opts);
    return { chunks: [{ meetingId: LIVE_ID, text: 'THEM: the kafka lag one, we changed partitions twenty four to forty eight', similarity: 0.71, chunkIndex: 0 }] };
  },
});
const rag = (retriever, liveId = LIVE_ID) => ({ getRetriever: () => retriever, getLiveMeetingId: () => liveId });
const input = (over = {}) => ({
  rag: null, segments, allowedSourceTypes: TEAM_MEET_SOURCES,
  userId: 'local', sessionId: 'sess-1', tokenBudget: 1200, ...over,
});
const decision = (q, scope) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'what-to-answer', modeId: 'team-meet',
  scope, sessionId: 'sess-1', transcriptQuestion: q,
});

describe('resolveMeetingEvidence', () => {
  test('no MEETING_TRANSCRIPT in the policy → no ports, no scope id, not in a live meeting', () => {
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever()), allowedSourceTypes: ['REFERENCE_FILE'] }));
    assert.deepEqual(r, { ports: [], scopeMeetingId: null, inLiveMeeting: false });
  });

  test('no live chunks → only the BM25 live-transcript port, scope id null, but still in a live meeting (segments only)', () => {
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever(), null) }));
    assert.equal(r.ports.length, 1);
    assert.equal(r.scopeMeetingId, null);
    assert.equal(r.inLiveMeeting, true, 'a built live-transcript port is still live-meeting evidence');
  });

  test('no RAG manager at all → still the live-transcript port, still in a live meeting', () => {
    const r = resolveMeetingEvidence(input({ rag: null }));
    assert.equal(r.ports.length, 1);
    assert.equal(r.inLiveMeeting, true);
  });

  test('nothing spoken and no chunks → no ports, not in a live meeting', () => {
    const r = resolveMeetingEvidence(input({ segments: [] }));
    assert.deepEqual(r, { ports: [], scopeMeetingId: null, inLiveMeeting: false });
  });

  test('live chunks → JIT port scoped to the live id PLUS the live-transcript port; scope id is the live id; in a live meeting', async () => {
    const calls = [];
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever(calls)) }));
    assert.equal(r.ports.length, 2);
    assert.equal(r.scopeMeetingId, LIVE_ID);
    assert.equal(r.inLiveMeeting, true);
    await r.ports[0].retrieve({ decision: decision('what happened with kafka', { userId: 'local', sessionId: 'sess-1', meetingId: LIVE_ID }) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].meetingId, LIVE_ID, 'the vector query must be scoped to the live index id');
  });

  test('a turn whose scope carries scopeMeetingId ADMITS the JIT chunk end to end', async () => {
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever()) }));
    const d = decision('what happened with kafka', { userId: 'local', sessionId: 'sess-1', meetingId: r.scopeMeetingId });
    const out = await r.ports[0].retrieve({ decision: d });
    assert.ok(out.evidence.some((e) => e.sourceType === 'MEETING_TRANSCRIPT' && /partitions twenty four to forty eight/.test(e.content)),
      `JIT chunk must be admitted: ${JSON.stringify(out)}`);
  });

  test('a turn WITHOUT the scope id rejects the JIT chunk OUT_OF_SCOPE — this is why scopeMeetingId exists', async () => {
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever()) }));
    const d = decision('what happened with kafka', { userId: 'local', sessionId: 'sess-1' });
    const out = await r.ports[0].retrieve({ decision: d });
    assert.equal(out.evidence.length, 0);
  });

  test('the live-transcript port answers from raw speech the indexer has not reached', async () => {
    const r = resolveMeetingEvidence(input({ rag: rag(jitRetriever()) }));
    const d = decision('did anyone mention the elasticsearch window', { userId: 'local', sessionId: 'sess-1', meetingId: LIVE_ID });
    const out = await r.ports[1].retrieve({ decision: d });
    assert.ok(out.evidence.some((e) => e.sourceId === LIVE_TRANSCRIPT_SOURCE_ID && /elasticsearch relocation window/.test(e.content)));
  });

  test('a throwing retriever factory does not take the live-transcript port down with it', () => {
    const broken = { getRetriever: () => { throw new Error('vector store closed'); }, getLiveMeetingId: () => LIVE_ID };
    const r = resolveMeetingEvidence(input({ rag: broken }));
    assert.equal(r.ports.length, 1);
    assert.equal(r.scopeMeetingId, null, 'no JIT port → no scope narrowing');
  });
});
