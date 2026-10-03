// electron/intelligence/__tests__/meetingRagEvidence.test.mjs
//
// Covers electron/intelligence/context-os/meetingRagEvidence.ts — wrapping
// meeting RAG chunks into typed EvidenceItems behind the capability check,
// the cross-meeting isolation rule and the similarity confidence gate.
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/intelligence/__tests__/meetingRagEvidence.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { MEETING_RAG_MIN_SIMILARITY, meetingChunksToEvidenceItems } = require(
  path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/meetingRagEvidence.js'),
);

const capability = (over = {}, permissions = {}) => ({
  sourceKind: 'meeting_rag_chunk',
  scopeId: null,
  authority: 'evidence',
  permissions: { retrieve: true, quote: true, useAsEvidence: true, useForReferentResolution: true, writeBackToMemory: false, ...permissions },
  trustLevel: 'meeting_recorded',
  pii: false,
  issuedBy: 'SourceAuthorityKernel',
  reason: 'test',
  ...over,
});

const contract = (allowedSources = [capability()], over = {}) => ({
  turnId: 'turn-7',
  sourceOwner: 'meeting_rag',
  requestedProperty: 'unknown',
  allowedSources,
  ...over,
});

const chunk = (over = {}) => ({
  id: 1,
  meetingId: 'm1',
  chunkIndex: 0,
  speaker: 'Alice',
  startMs: 1000,
  endMs: 2000,
  text: 'We agreed to ship the beta on Friday.',
  similarity: 0.8,
  ...over,
});

describe('MEETING_RAG_MIN_SIMILARITY', () => {
  test('is the 0.3 confidence floor', () => {
    assert.equal(MEETING_RAG_MIN_SIMILARITY, 0.3);
  });
});

describe('meetingChunksToEvidenceItems — capability check', () => {
  test('without a meeting_rag_chunk capability every chunk is rejected as forbidden', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk(), chunk({ meetingId: 'm2', chunkIndex: 5, text: 'other' })],
      contract: contract([]),
    });
    assert.deepEqual(out, {
      items: [],
      rejected: [
        { sourceKind: 'meeting_rag_chunk', sourceId: 'm1:0', reason: 'forbidden_source', textPreview: 'We agreed to ship the beta on Friday.' },
        { sourceKind: 'meeting_rag_chunk', sourceId: 'm2:5', reason: 'forbidden_source', textPreview: 'other' },
      ],
      confident: false,
    });
  });

  test('a capability for a different source kind does not grant meeting RAG', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk()],
      contract: contract([capability({ sourceKind: 'live_transcript' })]),
    });
    assert.equal(out.items.length, 0);
    assert.equal(out.rejected[0].reason, 'forbidden_source');
  });

  test('a capability without useAsEvidence is forbidden, even for a perfect match', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ similarity: 1 })],
      contract: contract([capability({ authority: 'referent_only' }, { useAsEvidence: false })]),
      currentMeetingId: 'm1',
    });
    assert.deepEqual(out.items, []);
    assert.equal(out.rejected.length, 1);
    assert.equal(out.rejected[0].reason, 'forbidden_source');
    assert.equal(out.confident, false);
  });

  test('no chunks: nothing accepted, nothing rejected, not confident', () => {
    assert.deepEqual(meetingChunksToEvidenceItems({ chunks: [], contract: contract() }), { items: [], rejected: [], confident: false });
    assert.deepEqual(meetingChunksToEvidenceItems({ chunks: [], contract: contract([]) }), { items: [], rejected: [], confident: false });
  });

  test('rejection previews are whitespace-collapsed and capped at 80 characters', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ text: `  spaced \n\n out\ttext ${'z'.repeat(200)}` })],
      contract: contract([]),
    });
    const { textPreview } = out.rejected[0];
    assert.equal(textPreview.length, 80);
    assert.ok(textPreview.startsWith('spaced out text zzz'));
  });
});

describe('meetingChunksToEvidenceItems — conversion', () => {
  test('a confident chunk becomes an EvidenceItem with full provenance', () => {
    const out = meetingChunksToEvidenceItems({ chunks: [chunk({ finalScore: 0.91 })], contract: contract() });
    assert.equal(out.confident, true);
    assert.deepEqual(out.rejected, []);
    assert.deepEqual(out.items, [{
      evidenceId: 'turn-7:meeting_rag:0',
      sourceKind: 'meeting_rag_chunk',
      sourceId: 'm1:0',
      sourceOwner: 'meeting_rag',
      authority: 'evidence',
      trustLevel: 'meeting_recorded',
      text: 'We agreed to ship the beta on Friday.',
      pointer: { meetingId: 'm1', chunkId: 'm1:0', timestampMs: 1000, speaker: 'Alice' },
      supports: { property: 'unknown' },
      score: { vector: 0.8, propertyMatch: 1, final: 0.91 },
      reasonIncluded: 'meeting RAG chunk under meeting_rag_chunk capability',
    }]);
  });

  test('the trust level comes from the granted capability', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk()],
      contract: contract([capability({ trustLevel: 'custom_trust' })]),
    });
    assert.equal(out.items[0].trustLevel, 'custom_trust');
  });

  test('the final score falls back to similarity when there is no numeric finalScore', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ similarity: 0.55 }), chunk({ chunkIndex: 1, similarity: 0.6, finalScore: '0.99' }), chunk({ chunkIndex: 2, similarity: 0.7, finalScore: 0 })],
      contract: contract(),
    });
    assert.deepEqual(out.items.map((i) => i.score.final), [0.55, 0.6, 0]);
  });

  test('the chunk text is passed through verbatim (not trimmed or collapsed)', () => {
    const text = '  leading and\n  inner whitespace  ';
    const out = meetingChunksToEvidenceItems({ chunks: [chunk({ text })], contract: contract() });
    assert.equal(out.items[0].text, text);
  });

  test('evidence ids count accepted chunks only, in input order', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [
        chunk({ chunkIndex: 0, similarity: 0.1 }),
        chunk({ chunkIndex: 1 }),
        chunk({ chunkIndex: 2, text: '   ' }),
        chunk({ chunkIndex: 3, meetingId: 'other' }),
        chunk({ chunkIndex: 4 }),
      ],
      contract: contract(),
      currentMeetingId: 'm1',
    });
    assert.deepEqual(out.items.map((i) => [i.evidenceId, i.sourceId]), [
      ['turn-7:meeting_rag:0', 'm1:1'],
      ['turn-7:meeting_rag:1', 'm1:4'],
    ]);
    assert.deepEqual(out.rejected.map((r) => [r.sourceId, r.reason]), [
      ['m1:0', 'low_confidence'],
      ['other:3', 'wrong_entity'],
    ]);
  });

  test('null chunks and chunks without usable text are skipped silently', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [null, undefined, chunk({ text: '' }), chunk({ text: ' \n ' }), chunk({ text: 123 }), chunk({ text: undefined })],
      contract: contract(),
    });
    assert.deepEqual(out, { items: [], rejected: [], confident: false });
  });

  test('a chunk that can prove the requested property is tagged with it', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [
        chunk({ chunkIndex: 0, text: 'We used a randomized controlled trial method in the study.' }),
        chunk({ chunkIndex: 1, text: 'The sky was blue and calm.' }),
      ],
      contract: contract([capability()], { requestedProperty: 'methodology' }),
    });
    assert.equal(out.items.length, 2, 'a property mismatch lowers the score but does not reject the chunk');
    assert.deepEqual(out.items[0].supports, { property: 'methodology' });
    assert.equal(out.items[0].score.propertyMatch, 1);
    assert.deepEqual(out.items[1].supports, { property: 'unknown' });
    assert.equal(out.items[1].score.propertyMatch, 0);
  });
});

describe('meetingChunksToEvidenceItems — confidence gate', () => {
  const run = (similarity) => meetingChunksToEvidenceItems({ chunks: [chunk({ similarity })], contract: contract() });

  test('similarity exactly at the floor is accepted', () => {
    const out = run(MEETING_RAG_MIN_SIMILARITY);
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].score.vector, 0.3);
    assert.equal(out.confident, true);
  });

  test('similarity just below the floor is rejected as low_confidence', () => {
    const out = run(0.2999);
    assert.deepEqual(out.items, []);
    assert.deepEqual(out.rejected, [
      { sourceKind: 'meeting_rag_chunk', sourceId: 'm1:0', reason: 'low_confidence', textPreview: 'We agreed to ship the beta on Friday.' },
    ]);
    assert.equal(out.confident, false);
  });

  test('zero and negative similarity are rejected', () => {
    for (const s of [0, -0.4]) assert.equal(run(s).rejected[0].reason, 'low_confidence', String(s));
  });

  test('a missing or non-numeric similarity counts as 0 and is rejected', () => {
    for (const s of [undefined, null, '0.9']) {
      const out = run(s);
      assert.equal(out.items.length, 0, String(s));
      assert.equal(out.rejected[0].reason, 'low_confidence', String(s));
    }
  });

  test('confident is true as soon as one chunk clears the gate', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ chunkIndex: 0, similarity: 0.05 }), chunk({ chunkIndex: 1, similarity: 0.31 }), chunk({ chunkIndex: 2, similarity: 0.1 })],
      contract: contract(),
    });
    assert.equal(out.confident, true);
    assert.equal(out.items.length, 1);
    assert.equal(out.rejected.length, 2);
  });
});

describe('meetingChunksToEvidenceItems — cross-meeting isolation', () => {
  const chunks = [chunk({ meetingId: 'live', chunkIndex: 0 }), chunk({ meetingId: 'old', chunkIndex: 3, text: 'From last quarter.' })];

  test('during a live meeting, chunks from another meeting are rejected as wrong_entity', () => {
    const out = meetingChunksToEvidenceItems({ chunks, contract: contract(), currentMeetingId: 'live' });
    assert.deepEqual(out.items.map((i) => i.pointer.meetingId), ['live']);
    assert.deepEqual(out.rejected, [
      { sourceKind: 'meeting_rag_chunk', sourceId: 'old:3', reason: 'wrong_entity', textPreview: 'From last quarter.' },
    ]);
    assert.equal(out.confident, true);
  });

  test('when nothing belongs to the live meeting the result is not confident', () => {
    const out = meetingChunksToEvidenceItems({ chunks: [chunks[1]], contract: contract(), currentMeetingId: 'live' });
    assert.deepEqual(out.items, []);
    assert.equal(out.confident, false);
  });

  test('wrong-meeting is reported in preference to low confidence', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ meetingId: 'old', similarity: 0.01 })],
      contract: contract(),
      currentMeetingId: 'live',
    });
    assert.equal(out.rejected[0].reason, 'wrong_entity');
  });

  test('without a current meeting id (post-meeting global search) every meeting is allowed', () => {
    for (const currentMeetingId of [undefined, null, '']) {
      const out = meetingChunksToEvidenceItems({ chunks, contract: contract(), currentMeetingId });
      assert.deepEqual(out.items.map((i) => i.pointer.meetingId), ['live', 'old'], String(currentMeetingId));
      assert.deepEqual(out.rejected, []);
    }
  });

  test('meeting ids are compared exactly (case-sensitive, no prefix match)', () => {
    const out = meetingChunksToEvidenceItems({
      chunks: [chunk({ meetingId: 'LIVE' }), chunk({ meetingId: 'live-2' })],
      contract: contract(),
      currentMeetingId: 'live',
    });
    assert.equal(out.items.length, 0);
    assert.deepEqual(out.rejected.map((r) => r.reason), ['wrong_entity', 'wrong_entity']);
  });
});

describe('meetingChunksToEvidenceItems — purity', () => {
  test('does not mutate its input', () => {
    const input = { chunks: [chunk(), chunk({ similarity: 0.1 })], contract: contract(), currentMeetingId: 'm1' };
    const snapshot = JSON.parse(JSON.stringify(input));
    meetingChunksToEvidenceItems(input);
    assert.deepEqual(input, snapshot);
  });
});
