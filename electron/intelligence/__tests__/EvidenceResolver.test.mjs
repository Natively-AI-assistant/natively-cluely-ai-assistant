// Evidence-execution-repair (2026-07-11) — unit tests for the single
// canonical retrieval entry point (EvidenceResolver). Uses fake
// hybrid-retriever/knowledge-manager deps so the strategy logic (OKF ->
// hybrid RAG -> lexical fallback -> insufficient) is tested in isolation,
// without depending on real embeddings/DB.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// EvidenceResolver's OKF path is self-gated by isOkfKnowledgePacksEnabled/
// isOkfHybridRetrievalEnabled (both default false everywhere per the P0
// verification branch's design — see docs/context-os/evidence-execution-
// repair/00_BASELINE.md). This test process turns them on to exercise the
// OKF branch; production/dev defaults are unaffected (env read fresh, no
// process-wide state this file could leak into another test file's run).
process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '1';
process.env.NATIVELY_OKF_HYBRID_RETRIEVAL = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const { EvidenceResolver } = await import(pathToFileURL(path.join(distDir, 'intelligence/context-os/EvidenceResolver.js')).href);
const co = await import(pathToFileURL(path.join(distDir, 'intelligence/context-os/index.js')).href);

const kernel = new co.SourceAuthorityKernel();

function referenceFilesContract(question, overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question,
    activeModeId: 'mode-test',
    activeModeName: 'Test mode',
    sourceAuthority: 'reference_files_only',
    answerShape: 'list',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: false,
    hasLiveTranscript: false,
    ...overrides,
  });
}

function fakeDeps(overrides = {}) {
  return {
    getModeSnapshot: () => ({ id: 'mode-test', templateType: 'general', customContext: 'test prompt' }),
    getReferenceFiles: () => [{ id: 'file-1', fileName: 'thesis.pdf', content: 'thesis content here' }],
    hybridRetriever: {
      retrieveHybrid: async () => ({ chunks: [], formattedContext: '', usedFallback: true, usedHybrid: false }),
    },
    knowledgeManager: {
      getPackForFile: () => null,
    },
    classifyQuestion: () => ({ type: 'unknown', isSynthesis: false, targetEntities: [] }),
    queryOkfCards: () => [],
    ...overrides,
  };
}

describe('EvidenceResolver: clarify turns never retrieve', () => {
  test('sourceOwner=clarify returns an insufficient pack with zero retrieval attempts', async () => {
    const contract = kernel.build({
      surface: 'manual_chat',
      question: 'What is the project?',
      activeModeId: 'mode-test',
      sourceAuthority: 'general_mixed',
      answerShape: 'general',
      voicePerspective: 'assistant_explanation',
      enforcement: 'observe',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: true,
    });
    assert.equal(contract.sourceOwner, 'clarify');

    let retrieveCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      hybridRetriever: { retrieveHybrid: async () => { retrieveCalled = true; return { chunks: [], formattedContext: '', usedFallback: true, usedHybrid: false }; } },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-1',
      question: 'What is the project?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(result.strategy, 'insufficient');
    assert.equal(retrieveCalled, false);
  });
});

describe('EvidenceResolver: reference_files_only turn cannot retrieve profile — capability-scoped', () => {
  test('a profile-owned contract never calls the reference-file retriever', async () => {
    const contract = kernel.build({
      surface: 'manual_chat',
      question: 'What are my skills?',
      activeModeId: 'mode-test',
      sourceAuthority: 'profile_only',
      answerShape: 'list',
      voicePerspective: 'first_person_candidate',
      enforcement: 'observe',
      hasReferenceFiles: false,
      hasProfileFacts: true,
      hasLiveTranscript: false,
    });
    assert.equal(contract.sourceOwner, 'profile');

    let retrieveCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      hybridRetriever: { retrieveHybrid: async () => { retrieveCalled = true; return { chunks: [], formattedContext: '', usedFallback: true, usedHybrid: false }; } },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-2',
      question: 'What are my skills?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(result.strategy, 'insufficient');
    assert.equal(retrieveCalled, false, 'the reference-file retriever must never be called for a profile-owned turn');
    assert.equal(result.rejectedSources[0]?.reason, 'forbidden_source');
  });
});

describe('EvidenceResolver: OKF path wins when a high-confidence card exists', () => {
  test('OKF card with a synthesis-question match produces an okf_exact strategy', async () => {
    const contract = referenceFilesContract('What is the main topic of this document?');
    const resolver = new EvidenceResolver(fakeDeps({
      classifyQuestion: () => ({ type: 'main_topic', isSynthesis: true, targetEntities: [] }),
      knowledgeManager: {
        getPackForFile: () => ({ packId: 'pack-1', packVersion: 1, cards: [{ id: 'card-1', title: 'Overview', body: 'This document is about AgenticVLA.', sourcePages: [1], sourceSections: ['Intro'], entities: ['AgenticVLA'], confidence: 'high', approvalStatus: 'approved' }] }),
      },
      queryOkfCards: (pack) => pack.cards.map((card) => ({ card, score: 0.9 })),
    }));
    const result = await resolver.resolve({
      turnId: 'turn-3',
      question: 'What is the main topic of this document?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(result.strategy, 'okf_exact');
    assert.equal(result.pack.items.length, 1);
    assert.equal(result.pack.items[0].sourceKind, 'okf_document_card');
    assert.equal(result.pack.answerPolicy, 'answer');
  });
});

describe('EvidenceResolver: falls through to hybrid RAG when OKF has no pack', () => {
  test('no OKF pack -> hybrid retrieval runs and its chunks become the pack', async () => {
    const contract = referenceFilesContract('What controller does the robot use?');
    const resolver = new EvidenceResolver(fakeDeps({
      hybridRetriever: {
        retrieveHybrid: async () => ({
          chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: 'The controller is an NVIDIA Jetson Xavier.', chunkIndex: 0, score: 0.7, ftsScore: 0.6, vectorScore: 0.8 }],
          formattedContext: 'irrelevant-legacy-string',
          usedFallback: false,
          usedHybrid: true,
        }),
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-4',
      question: 'What controller does the robot use?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'processor_or_controller',
    });
    assert.equal(result.strategy, 'hybrid_rag');
    assert.equal(result.pack.items.length, 1);
    assert.equal(result.pack.items[0].sourceKind, 'mode_reference_chunk');
    assert.match(result.pack.items[0].text, /Jetson Xavier/);
  });
});

describe('EvidenceResolver: insufficient evidence never fabricates', () => {
  test('empty hybrid result + no OKF pack -> insufficient, no items', async () => {
    const contract = referenceFilesContract('How many trajectories were in the dataset?');
    const resolver = new EvidenceResolver(fakeDeps());
    const result = await resolver.resolve({
      turnId: 'turn-5',
      question: 'How many trajectories were in the dataset?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'dataset_size',
    });
    assert.equal(result.strategy, 'insufficient');
    assert.equal(result.pack.items.length, 0);
    assert.equal(result.pack.answerPolicy, 'refuse_insufficient_evidence');
  });

  test('low-confidence hybrid result for a property question is treated as insufficient, not answered', async () => {
    const contract = referenceFilesContract('Who funded this research?');
    const resolver = new EvidenceResolver(fakeDeps({
      hybridRetriever: {
        retrieveHybrid: async () => ({
          chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: 'This work was conducted at a research lab.', chunkIndex: 3, score: 0.15, ftsScore: 0.1, vectorScore: 0.1 }],
          formattedContext: '',
          usedFallback: false,
          usedHybrid: true,
        }),
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-6',
      question: 'Who funded this research?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'funding_source',
    });
    assert.equal(result.strategy, 'insufficient');
    assert.equal(result.pack.answerPolicy, 'refuse_insufficient_evidence');
  });
});

describe('EvidenceResolver: pack identity is stable and traceable', () => {
  test('every returned pack carries a real packId, turnId, and version', async () => {
    const contract = referenceFilesContract('What was used for teleoperation?');
    const resolver = new EvidenceResolver(fakeDeps({
      hybridRetriever: {
        retrieveHybrid: async () => ({
          chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: 'Unity and Meta Quest 3 were used for VR teleoperation.', chunkIndex: 1, score: 0.6, ftsScore: 0.5, vectorScore: 0.6 }],
          formattedContext: '',
          usedFallback: false,
          usedHybrid: true,
        }),
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-7',
      question: 'What was used for teleoperation?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.ok(result.pack.packId, 'packId must be present');
    assert.equal(result.pack.turnId, 'turn-7');
    assert.equal(result.pack.version, 1);
  });
});
