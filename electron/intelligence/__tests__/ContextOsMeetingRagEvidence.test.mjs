// Context OS Phase 12 — meeting RAG EvidencePack integration.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsMeetingRagEvidence.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();

function transcriptContract(question = 'What did they say about the deadline?') {
  return kernel.build({
    surface: 'manual_chat', question, activeModeId: 'meeting-mode',
    sourceAuthority: 'transcript_only', answerShape: 'general',
    voicePerspective: 'assistant_explanation', enforcement: 'observe',
    hasReferenceFiles: false, hasProfileFacts: true, hasLiveTranscript: true,
  });
}

function chunk(overrides = {}) {
  return {
    id: 1, meetingId: 'mtg-1', chunkIndex: 0, speaker: 'PM',
    startMs: 60000, endMs: 90000,
    text: 'PM: the deadline moved to Q3 after the vendor slip.',
    tokenCount: 20, similarity: 0.8, finalScore: 0.75,
    ...overrides,
  };
}

test('meeting chunks become typed EvidenceItems with full provenance', () => {
  const { items } = co.meetingChunksToEvidenceItems({
    chunks: [chunk()],
    contract: transcriptContract(),
    currentMeetingId: 'mtg-1',
  });
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.sourceKind, 'meeting_rag_chunk');
  assert.equal(it.sourceOwner, 'meeting_rag');
  assert.equal(it.pointer.meetingId, 'mtg-1');
  assert.equal(it.pointer.chunkId, 'mtg-1:0');
  assert.equal(it.pointer.timestampMs, 60000);
  assert.equal(it.pointer.speaker, 'PM');
  assert.equal(it.score.vector, 0.8);
  assert.equal(it.score.final, 0.75);
});

test('CROSS-MEETING ISOLATION: chunks from another meeting are rejected during a live meeting', () => {
  const { items, rejected } = co.meetingChunksToEvidenceItems({
    chunks: [chunk(), chunk({ meetingId: 'mtg-OLD', chunkIndex: 5, text: 'Old meeting: deadline was Q4.' })],
    contract: transcriptContract(),
    currentMeetingId: 'mtg-1',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].pointer.meetingId, 'mtg-1');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'wrong_entity');
  assert.equal(rejected[0].sourceId, 'mtg-OLD:5');
});

test('post-meeting global search (no currentMeetingId) allows cross-meeting evidence explicitly', () => {
  const { items } = co.meetingChunksToEvidenceItems({
    chunks: [chunk({ meetingId: 'mtg-A' }), chunk({ meetingId: 'mtg-B', chunkIndex: 2 })],
    contract: transcriptContract(),
    currentMeetingId: null,
  });
  assert.equal(items.length, 2);
});

test('CONFIDENCE GATE: low-similarity chunks are rejected, not silently included', () => {
  const { items, rejected, confident } = co.meetingChunksToEvidenceItems({
    chunks: [chunk({ similarity: 0.1, finalScore: 0.1 })],
    contract: transcriptContract(),
    currentMeetingId: 'mtg-1',
  });
  assert.equal(items.length, 0);
  assert.equal(confident, false);
  assert.equal(rejected[0].reason, 'low_confidence');
});

test('contract without meeting_rag capability rejects everything as forbidden_source', () => {
  const docContract = kernel.build({
    surface: 'manual_chat', question: 'What are the phases?', activeModeId: 'm1',
    sourceAuthority: 'reference_files_only', answerShape: 'list',
    voicePerspective: 'assistant_explanation', enforcement: 'observe',
    hasReferenceFiles: true, hasProfileFacts: false, hasLiveTranscript: false,
  });
  const { items, rejected } = co.meetingChunksToEvidenceItems({
    chunks: [chunk()],
    contract: docContract,
    currentMeetingId: 'mtg-1',
  });
  assert.equal(items.length, 0);
  assert.equal(rejected[0].reason, 'forbidden_source');
});

test('rejected previews are capped (privacy-safe traces)', () => {
  const { rejected } = co.meetingChunksToEvidenceItems({
    chunks: [chunk({ similarity: 0.05, text: 'x'.repeat(500) })],
    contract: transcriptContract(),
    currentMeetingId: 'mtg-1',
  });
  assert.ok(rejected[0].textPreview.length <= 80);
});

test('property stamping: deadline chunk does not satisfy funding_source', () => {
  const fundingContract = kernel.build({
    surface: 'manual_chat', question: 'Who funded this initiative?', activeModeId: 'meeting-mode',
    sourceAuthority: 'transcript_only', answerShape: 'general',
    voicePerspective: 'assistant_explanation', enforcement: 'observe',
    hasReferenceFiles: false, hasProfileFacts: false, hasLiveTranscript: true,
  });
  assert.equal(fundingContract.requestedProperty, 'funding_source');
  const { items } = co.meetingChunksToEvidenceItems({
    chunks: [chunk()],
    contract: fundingContract,
    currentMeetingId: 'mtg-1',
  });
  assert.equal(items[0].supports.property, 'unknown', 'deadline text cannot prove funding');
});
