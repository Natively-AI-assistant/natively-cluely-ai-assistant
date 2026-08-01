// Issue 10 / Pattern D (2026-08-01): typed evidence provenance + the
// test-transcript injection gate.
//
// Provenance records where evidence text PHYSICALLY came from, stamped by the
// one layer that knows (each retrieval port) and never inferred from filename,
// title, or content. A reference file named like a transcript must carry
// MODE_REFERENCE_FILE provenance; an injected test transcript is
// TEST_TRANSCRIPT, never LIVE_STT. Enforcement is guarded on the stamp being
// present, so unstamped legacy stores cannot turn it into an inert filter
// that measures as a pass.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..', '..');
const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { createModeRetrievalPort } = await load('retrieval/mode-retrieval-port.js');
const { createMeetingRetrievalPort } = await load('retrieval/meeting-retrieval-port.js');
const { adaptLegacyChunks } = await load('retrieval/legacy-adapter.js');
const { decide, evidenceSupportsClaim } = await load('orchestration/orchestrator.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

const decisionFor = (q, modeId) => decide({
  requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId,
  scope: { userId: 'u', modeId }, sessionId: 's', manualQuestion: q,
});

describe('provenance: mode port stamps MODE_REFERENCE_FILE regardless of filename', () => {
  test('a file NAMED like a transcript still carries reference-file provenance', async () => {
    const port = createModeRetrievalPort({
      modesManager: {
        retrieveHybridRaw: async () => ({
          chunks: [{ sourceId: 'f1', fileName: '03_standup_transcript.md', text: 'Anita: we should ship Friday.', chunkIndex: 0, score: 0.9 }],
        }),
      },
      modeInfo: { id: 'team-meet' },
      files: [{ id: 'f1', fileName: '03_standup_transcript.md', content: 'Anita: we should ship Friday.' }],
      allowedSourceTypes: ['REFERENCE_FILE'],
      tokenBudget: 2000,
      userId: 'u',
    });
    // Note: asking about "the transcript" plans MEETING_TRANSCRIPT only and the
    // reference file is (correctly) filtered — that isolation is pinned
    // elsewhere. Here the question targets the brief so the file IS admitted,
    // and the transcript-like FILENAME must not affect its provenance.
    const { evidence } = await port.retrieve({
      decision: decisionFor('What is the meeting objective?', 'team-meet'),
    });
    assert.ok(evidence.length > 0, 'fixture must retrieve');
    assert.equal(evidence[0].provenance, 'MODE_REFERENCE_FILE');
  });
});

describe('provenance: meeting port stamps transcript provenance', () => {
  const mkPort = () => createMeetingRetrievalPort({
    retriever: {
      retrieve: async () => ({
        chunks: [{ meetingId: 'm1', text: 'Decision: adopt the rollout plan.', chunkIndex: 0, similarity: 0.8 }],
      }),
    },
    currentMeetingId: 'm1', userId: 'u', tokenBudget: 2000,
  });
  const meetingDecision = () => decide({
    requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'team-meet',
    scope: { userId: 'u', modeId: 'team-meet', meetingId: 'm1' }, sessionId: 's',
    manualQuestion: 'What did we decide?',
  });

  test('LIVE_STT by default', async () => {
    delete process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION;
    const { evidence } = await mkPort().retrieve({ decision: meetingDecision() });
    assert.ok(evidence.length > 0, 'meeting chunk must be admitted');
    assert.equal(evidence[0].provenance, 'LIVE_STT');
  });

  test('TEST_TRANSCRIPT under the injection env — never LIVE_STT in a test run', async () => {
    process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION = '1';
    try {
      const { evidence } = await mkPort().retrieve({ decision: meetingDecision() });
      assert.equal(evidence[0]?.provenance, 'TEST_TRANSCRIPT');
    } finally {
      delete process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION;
    }
  });
});

describe('provenance: adapter passes known values and drops unknown ones', () => {
  const opts = {
    scope: { userId: 'u' },
    sourceTypes: new Map([['s1', 'REFERENCE_FILE']]),
    activeVersions: new Map([['s1', 'v1']]),
    chunkVersions: new Map([['s1', 'v1']]),
    sourceScopes: new Map([['s1', { userId: 'u' }]]),
  };
  test('known value survives; junk is dropped, never guessed', () => {
    const { evidence } = adaptLegacyChunks([
      { sourceId: 's1', text: 'a', chunkIndex: 0, provenance: 'MODE_REFERENCE_FILE' },
      { sourceId: 's1', text: 'b', chunkIndex: 1, provenance: 'TOTALLY_MADE_UP' },
      { sourceId: 's1', text: 'c', chunkIndex: 2 },
    ], opts);
    assert.equal(evidence[0].provenance, 'MODE_REFERENCE_FILE');
    assert.equal(evidence[1].provenance, undefined);
    assert.equal(evidence[2].provenance, undefined);
  });
});

describe('provenance: meeting claims reject stamped non-transcript evidence', () => {
  const q = 'What did we decide about the rollout?';
  test('a reference-file-provenance chunk cannot prove a MEETING_DECISION', () => {
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['MEETING_DECISION'], content: 'Decision: adopt the rollout plan.', provenance: 'MODE_REFERENCE_FILE' },
      'MEETING_DECISION', q,
    ), false);
  });
  test('transcript provenance (live or approved test) can', () => {
    for (const p of ['LIVE_STT', 'TEST_TRANSCRIPT']) {
      assert.equal(evidenceSupportsClaim(
        { acceptedFor: ['MEETING_DECISION'], content: 'Decision: adopt the rollout plan.', provenance: p },
        'MEETING_DECISION', q,
      ), true, p);
    }
  });
  test('GUARD: unstamped legacy evidence is unaffected', () => {
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['MEETING_DECISION'], content: 'Decision: adopt the rollout plan.' },
      'MEETING_DECISION', q,
    ), true);
  });
  test('non-meeting claims ignore provenance entirely', () => {
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'The rollout plan has three decision stages.', provenance: 'MODE_REFERENCE_FILE' },
      'DOCUMENT_FACT', 'How many stages are in the rollout plan?',
    ), true);
  });
});

describe('provenance: packer renders the attribute', () => {
  test('provenance appears on the evidence tag', async () => {
    const d = decisionFor('What does the brief say about rollout?', 'team-meet');
    const composed = composePrompt({
      decision: d, policy: MODE_POLICIES['team-meet'],
      evidence: [{
        evidenceId: 'ev-1', sourceType: 'REFERENCE_FILE', sourceId: 'f1', versionId: 'v1',
        retrievedVersionId: 'v1', scopeId: 'u:u', documentTitle: 'brief.md', chunkIndex: 0,
        content: 'The brief proposes a 10 percent rollout.', provenance: 'MODE_REFERENCE_FILE',
        finalScore: 0.9, authorityFor: ['DOCUMENT_FACT'], isDirectFact: true, isInferred: false,
        metadata: {}, trustLevel: 'untrusted_reference', acceptedFor: ['DOCUMENT_FACT'],
      }],
    });
    assert.match(composed.user, /provenance="MODE_REFERENCE_FILE"/);
  });
});

describe('injection framework gates (source-pinned: ipcHandlers cannot run outside Electron)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const mm = fs.readFileSync(path.join(repoRoot, 'electron/intelligence/MeetingMemoryService.ts'), 'utf8');

  test('the handler requires BOTH the env opt-in and an unpackaged build', () => {
    const i = src.indexOf("safeHandle('debug-inject-transcript'");
    assert.ok(i !== -1, 'injection handler missing');
    const block = src.slice(i, i + 2200);
    assert.match(block, /NATIVELY_TEST_TRANSCRIPT_INJECTION !== '1' \|\| app\.isPackaged/);
    assert.match(block, /origin: 'test'/);
    assert.doesNotMatch(block, /origin: 'stt'/, "injected segments must never claim real STT provenance");
    assert.match(block, /segments\.length > 500/, 'batch size must be bounded');
  });

  test('eligibility accepts origin test ONLY under the same env gate', async () => {
    const { isMemoryEligibleSegment } = await import(
      pathToFileURL(path.join(repoRoot, 'dist-electron/electron/intelligence/MeetingMemoryService.js')).href);
    const seg = { speaker: 'Anita', text: 'Ship Friday.', origin: 'test', confidence: 0.95 };
    delete process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION;
    assert.equal(isMemoryEligibleSegment(seg), false, 'test origin must stay ineligible by default');
    process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION = '1';
    try {
      assert.equal(isMemoryEligibleSegment(seg), true, 'approved test transcripts are eligible in test runs');
      assert.equal(isMemoryEligibleSegment({ ...seg, origin: 'manual_chat' }), false,
        'the env must not widen anything except origin test');
      assert.equal(isMemoryEligibleSegment({ ...seg, origin: 'assistant' }), false);
    } finally {
      delete process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION;
    }
    // Source-level pin of the same invariant, so a refactor can't silently
    // widen the gate.
    assert.match(mm, /origin === 'test' && process\.env\.NATIVELY_TEST_TRANSCRIPT_INJECTION === '1'/);
  });
});
