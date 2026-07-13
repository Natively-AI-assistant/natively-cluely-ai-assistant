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
  test('a structure question does not accept an unrelated OKF card before hybrid retrieval', async () => {
    const contract = referenceFilesContract('What page does the table of contents say Section 2 begins on?');
    let hybridCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      knowledgeManager: {
        getPackForFile: () => ({ packId: 'pack-structure', packVersion: 1, cards: [{ id: 'card-1', title: 'Methods', body: 'The methodology uses interviews.', sourcePages: [10], sourceSections: ['2 Methods'], entities: [], confidence: 'high', approvalStatus: 'approved' }] }),
      },
      queryOkfCards: (pack) => pack.cards.map((card) => ({ card, score: 0.9 })),
      hybridRetriever: {
        retrieveHybrid: async () => {
          hybridCalled = true;
          return {
            chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: '[Table of Contents | p2]\n2 Methods 10', chunkIndex: 0, score: 0.9, ftsScore: 0.6, vectorScore: 0.8 }],
            formattedContext: '', usedFallback: false, usedHybrid: true,
          };
        },
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-structure',
      question: 'What page does the table of contents say Section 2 begins on?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'document_structure',
    });
    assert.equal(hybridCalled, true, 'an unrelated topical card cannot short-circuit structural retrieval');
    assert.equal(result.strategy, 'hybrid_rag');
    assert.equal(result.pack.items[0].sourceKind, 'mode_reference_chunk');
  });

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

// Regression (2026-07-13): OKF card scoring is title/entity-centric, so a
// specific-fact question that NAMES an entity ("What working voltage is listed
// for Robot X?") let the topical PARENT card win on the entity match even though
// the value lives in a differently-titled sub-section the parent card does not
// contain. The distinctive-term gate makes a non-synthesis question fall through
// to hybrid RAG when the TOP OKF card carries none of the question's distinctive
// (non-entity) terms — so the exact sub-section is retrieved instead.
describe('EvidenceResolver: distinctive-term gate falls through to hybrid for entity-named spec lookups', () => {
  test('top OKF card that is a pure topical/entity match (no distinctive term) yields hybrid, not OKF', async () => {
    const contract = referenceFilesContract('What working voltage is listed for Robot X?');
    let hybridCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      // entity_lookup: names the entity, not synthesis.
      classifyQuestion: () => ({ type: 'entity_lookup', isSynthesis: false, targetEntities: ['Robot X'] }),
      knowledgeManager: {
        getPackForFile: () => ({
          packId: 'pack-1', packVersion: 1,
          cards: [
            // Topical PARENT card: matches the entity + scores high, but its body
            // never mentions "voltage" (the distinctive term).
            { id: 'c-parent', title: 'Robot X', body: 'Robot X is a dual-arm mobile robot for manipulation and navigation tasks.', sourcePages: [16], sourceSections: ['2.3 Robot X'], entities: ['Robot X'], confidence: 'high', approvalStatus: 'approved' },
          ],
        }),
      },
      // The parent card scores above the OKF acceptance floor purely on entity/title.
      queryOkfCards: (pack) => pack.cards.map((card) => ({ card, score: 0.9 })),
      hybridRetriever: {
        retrieveHybrid: async () => {
          hybridCalled = true;
          return {
            chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: '[Section 2.3.2 | p17] Technical Specifications\nWorking Voltage: 24 V', chunkIndex: 0, score: 0.9, ftsScore: 0.5, vectorScore: 0.7 }],
            formattedContext: '', usedFallback: false, usedHybrid: true,
          };
        },
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-spec',
      question: 'What working voltage is listed for Robot X?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(hybridCalled, true, 'a topical parent card must not short-circuit a distinct-fact lookup');
    assert.equal(result.strategy, 'hybrid_rag');
    assert.match(result.pack.items[0].text, /Working Voltage: 24 V/);
  });

  test('salient-term gate: a topical card carrying only a FILLER distinctive word (not the rare answer word) still falls through to hybrid', async () => {
    // Real-thesis failure mode: "What WORKING VOLTAGE is listed for Robot X?" has
    // two distinctive terms — "working" (appears in many prose cards) and
    // "voltage" (appears in ~1 spec card). Topical cards that mention "working"
    // (but never "voltage") must NOT satisfy the gate; the answer lives only in
    // the spec sub-section reachable via hybrid.
    const contract = referenceFilesContract('What working voltage is listed for Robot X?');
    let hybridCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      classifyQuestion: () => ({ type: 'entity_lookup', isSynthesis: false, targetEntities: ['Robot X'] }),
      knowledgeManager: {
        getPackForFile: () => ({
          packId: 'pack-1', packVersion: 1,
          cards: [
            // Topical parent + several prose cards that contain "working" but never
            // "voltage" — so "working" is high-frequency, "voltage" is rare (df 0
            // among these selected cards; the corpus has it only in the spec chunk).
            { id: 'c-parent', title: 'Robot X', body: 'Robot X is a robot working across manipulation and navigation tasks.', sourcePages: [16], sourceSections: ['2.3 Robot X'], entities: ['Robot X'], confidence: 'high', approvalStatus: 'approved' },
            { id: 'c-prose1', title: 'System Overview', body: 'The system is working reliably in dynamic environments.', sourcePages: [5], sourceSections: ['1 Intro'], entities: [], confidence: 'high', approvalStatus: 'approved' },
            { id: 'c-prose2', title: 'Control Pipeline', body: 'The control loop keeps the arms working in sync.', sourcePages: [27], sourceSections: ['3.1 Control'], entities: [], confidence: 'high', approvalStatus: 'approved' },
          ],
        }),
      },
      queryOkfCards: (pack) => pack.cards.map((card) => ({ card, score: 0.9 })),
      hybridRetriever: {
        retrieveHybrid: async () => {
          hybridCalled = true;
          return {
            chunks: [{ sourceId: 'file-1', fileName: 'thesis.pdf', text: '[Section 2.3.2 | p17] Technical Specifications\nWorking Voltage: 24 V', chunkIndex: 0, score: 0.9, ftsScore: 0.5, vectorScore: 0.7 }],
            formattedContext: '', usedFallback: false, usedHybrid: true,
          };
        },
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-salient',
      question: 'What working voltage is listed for Robot X?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(hybridCalled, true, 'a filler distinctive word ("working") must not retain a topical card when the rare answer word ("voltage") is absent');
    assert.equal(result.strategy, 'hybrid_rag');
    assert.match(result.pack.items[0].text, /Working Voltage: 24 V/);
  });

  test('top OKF card that DOES contain the distinctive term is still served from OKF', async () => {
    const contract = referenceFilesContract('What working voltage is listed for Robot X?');
    let hybridCalled = false;
    const resolver = new EvidenceResolver(fakeDeps({
      classifyQuestion: () => ({ type: 'entity_lookup', isSynthesis: false, targetEntities: ['Robot X'] }),
      knowledgeManager: {
        getPackForFile: () => ({
          packId: 'pack-1', packVersion: 1,
          cards: [
            // This card's body carries the distinctive term "voltage" — OKF can answer.
            { id: 'c-spec', title: 'Technical Specifications', body: 'Working Voltage: 24 V. Battery Life: up to 8 hours.', sourcePages: [17], sourceSections: ['2.3.2 Technical Specifications'], entities: ['Robot X'], confidence: 'high', approvalStatus: 'approved' },
          ],
        }),
      },
      queryOkfCards: (pack) => pack.cards.map((card) => ({ card, score: 0.9 })),
      hybridRetriever: {
        retrieveHybrid: async () => { hybridCalled = true; return { chunks: [], formattedContext: '', usedFallback: true, usedHybrid: false }; },
      },
    }));
    const result = await resolver.resolve({
      turnId: 'turn-spec-2',
      question: 'What working voltage is listed for Robot X?',
      sourceContract: contract,
      activeMode: { modeId: 'mode-test' },
      requestedProperty: 'unknown',
    });
    assert.equal(hybridCalled, false, 'an OKF card that carries the distinctive term must not fall through');
    assert.equal(result.strategy, 'okf_exact');
    assert.match(result.pack.items[0].text, /Working Voltage: 24 V/);
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
