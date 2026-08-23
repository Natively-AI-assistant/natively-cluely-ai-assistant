// Context OS Phase 4 — EvidenceOrchestrator: capability-scoped retrieval.
//
// The critical property: a retriever for a FORBIDDEN source is NEVER CALLED —
// the wrong source is impossible to access, not merely discouraged.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsEvidenceOrchestrator.test.mjs

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
const orchestrator = new co.EvidenceOrchestrator();

function contractFor(overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question: 'What are the four main phases of the project?',
    activeModeId: 'mode-1',
    sourceAuthority: 'reference_files_only',
    answerShape: 'list',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: true,
    ...overrides,
  });
}

const MODE_BLOCK = [
  '<active_mode_retrieved_context>',
  '  <snippet>',
  '    <source>{"sourceId":"file-9","fileName":"thesis.pdf","chunkIndex":3,"score":0.42,"ftsScore":0.5,"vectorScore":0.3,"trustLevel":"untrusted_reference"}</source>',
  '    <text>[Section 3.1 | p12] The project consists of four phases: requirements, design, implementation, and evaluation.</text>',
  '  </snippet>',
  '  <snippet>',
  '    <source>{"sourceId":"file-9","fileName":"thesis.pdf","chunkIndex":7,"score":0.31,"ftsScore":0.2,"vectorScore":0.4,"trustLevel":"untrusted_reference"}</source>',
  '    <text>[Section 5 | p40] The evaluation compared success rates across benchmarks.</text>',
  '  </snippet>',
  '</active_mode_retrieved_context>',
].join('\n');

// ── Forbidden sources are never fetched ─────────────────────────────────────

test('doc-grounded pack: profile retriever is NEVER CALLED; rejection recorded', async () => {
  let profileCalled = false;
  let hindsightCalled = false;
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four main phases of the project?',
    contract: contractFor(),
    retrievers: {
      retrieveModeContext: () => MODE_BLOCK,
      retrieveProfileContext: () => { profileCalled = true; return 'RESUME FACTS'; },
      retrieveHindsight: () => { hindsightCalled = true; return 'OLD MEMORY'; },
    },
  });
  assert.equal(profileCalled, false, 'profile retriever must not be invoked');
  assert.equal(hindsightCalled, false, 'hindsight retriever must not be invoked');
  assert.ok(pack.rejected.some((r) => r.sourceKind === 'profile_resume' && r.reason === 'forbidden_source'));
  assert.ok(pack.rejected.some((r) => r.sourceKind === 'hindsight_memory' && r.reason === 'forbidden_source'));
  // And no profile text anywhere in the pack.
  assert.ok(!JSON.stringify(pack).includes('RESUME FACTS'));
  assert.ok(!JSON.stringify(pack).includes('OLD MEMORY'));
});

test('profile pack: mode-context retriever is NEVER CALLED', async () => {
  let modeCalled = false;
  const pack = await orchestrator.buildEvidencePack({
    question: 'What is my best project?',
    contract: contractFor({ sourceAuthority: 'profile_only', question: 'What is my best project?' }),
    retrievers: {
      retrieveModeContext: () => { modeCalled = true; return MODE_BLOCK; },
      retrieveProfileContext: () => '<candidate_profile>Built Natively, an AI assistant project.</candidate_profile>',
    },
  });
  assert.equal(modeCalled, false, 'mode retriever must not be invoked in profile ownership');
  assert.equal(pack.items.length, 1);
  assert.equal(pack.items[0].sourceKind, 'profile_resume');
  assert.equal(pack.answerPolicy, 'answer');
});

test('clarify contract: NOTHING is retrieved; policy=ask_clarification', async () => {
  let anyCalled = false;
  const clarifyContract = contractFor({ sourceAuthority: 'general_mixed', question: 'What are the project phases?' });
  assert.equal(clarifyContract.sourceOwner, 'clarify');
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the project phases?',
    contract: clarifyContract,
    retrievers: {
      retrieveModeContext: () => { anyCalled = true; return MODE_BLOCK; },
      retrieveProfileContext: () => { anyCalled = true; return 'X'; },
    },
  });
  assert.equal(anyCalled, false);
  assert.equal(pack.answerPolicy, 'ask_clarification');
  assert.equal(pack.items.length, 0);
});

// ── Snippet parsing → real provenance ───────────────────────────────────────

test('mode snippets parse into typed items with chunk provenance and scores', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four main phases of the project?',
    contract: contractFor(),
    retrievers: { retrieveModeContext: () => MODE_BLOCK },
  });
  assert.equal(pack.items.length, 2);
  const first = pack.items[0];
  assert.equal(first.sourceKind, 'mode_reference_chunk');
  assert.equal(first.sourceId, 'file-9');
  assert.equal(first.pointer.chunkId, 'file-9:3');
  assert.equal(first.score.lexical, 0.5);
  assert.equal(first.score.final, 0.42);
  // First snippet mentions "phases" → supports phase_or_stage; second does not.
  assert.equal(first.supports.property, 'phase_or_stage');
  assert.equal(pack.items[1].supports.property, 'unknown');
  assert.equal(pack.coverage.propertySatisfied, true);
  assert.equal(pack.coverage.sourceOwnerSatisfied, true);
  assert.equal(pack.answerPolicy, 'answer');
});

test('non-snippet block falls back to a single whole-block item', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four main phases of the project?',
    contract: contractFor(),
    retrievers: { retrieveModeContext: () => 'Plain lexical block: the four phases are A, B, C, D.' },
  });
  assert.equal(pack.items.length, 1);
  assert.equal(pack.items[0].sourceKind, 'mode_reference_chunk');
  assert.equal(pack.coverage.propertySatisfied, true);
});

// ── Referent-only handling ──────────────────────────────────────────────────

test('transcript in reference_files_only becomes a referent-only item, not evidence', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four main phases of the project?',
    contract: contractFor(),
    retrievers: {
      retrieveModeContext: () => MODE_BLOCK,
      retrieveTranscriptContext: () => 'Interviewer: tell us about the phases you mentioned.',
    },
  });
  const transcriptItems = pack.items.filter((i) => i.sourceKind === 'live_transcript');
  assert.equal(transcriptItems.length, 1);
  assert.equal(transcriptItems[0].authority, 'referent_only');
  // Referent items never count toward coverage.
  const factual = pack.items.filter((i) => i.authority === 'evidence');
  assert.ok(factual.every((i) => i.sourceKind === 'mode_reference_chunk'));
});

test('hindsight under an evidence grant is STILL demoted to referent-only (no provenance yet)', async () => {
  // transcript ownership grants hindsight read in memory policy, but item-level
  // authority stays referent_only until Phase 10 provenance exists.
  const c = contractFor({ sourceAuthority: 'transcript_only', question: 'What did we decide last time about the deadline?' });
  // hindsight_memory has no capability at all in transcript ownership → forbidden.
  const pack = await orchestrator.buildEvidencePack({
    question: 'What did we decide about the deadline?',
    contract: c,
    retrievers: {
      retrieveTranscriptContext: () => 'PM: the deadline moved to Q3.',
      retrieveHindsight: () => 'Memory: deadline was Q4.',
    },
  });
  const hs = pack.items.filter((i) => i.sourceKind === 'hindsight_memory');
  assert.equal(hs.length, 0, 'no hindsight capability in transcript_only → not retrieved');
  assert.ok(pack.rejected.some((r) => r.sourceKind === 'hindsight_memory'));
});

// ── Empty evidence → refusal policy ─────────────────────────────────────────

test('no evidence retrieved → refuse_insufficient_evidence', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the four main phases of the project?',
    contract: contractFor(),
    retrievers: { retrieveModeContext: () => '' },
  });
  assert.equal(pack.answerPolicy, 'refuse_insufficient_evidence');
  assert.equal(pack.coverage.hasDirectEvidence, false);
});

test('retriever throwing never breaks the pack build', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What are the phases?',
    contract: contractFor(),
    retrievers: { retrieveModeContext: () => { throw new Error('db down'); } },
  });
  assert.equal(pack.answerPolicy, 'refuse_insufficient_evidence');
});

// ── Property gating in coverage ─────────────────────────────────────────────

test('topic-overlap evidence without property vocabulary → refuse (funding vs collaboration)', async () => {
  const collabBlock = [
    '<active_mode_retrieved_context>',
    '  <snippet>',
    '    <source>{"sourceId":"file-9","fileName":"thesis.pdf","chunkIndex":1,"score":0.6}</source>',
    '    <text>This research was conducted in collaboration with Huawei Munich Research Center.</text>',
    '  </snippet>',
    '</active_mode_retrieved_context>',
  ].join('\n');
  const pack = await orchestrator.buildEvidencePack({
    question: 'Who funded this research?',
    contract: contractFor({ question: 'Who funded this research?' }),
    retrievers: { retrieveModeContext: () => collabBlock },
  });
  assert.equal(pack.requestedProperty, 'funding_source');
  assert.equal(pack.coverage.hasDirectEvidence, true);
  assert.equal(pack.coverage.propertySatisfied, false);
  assert.equal(pack.answerPolicy, 'refuse_insufficient_evidence');
});
