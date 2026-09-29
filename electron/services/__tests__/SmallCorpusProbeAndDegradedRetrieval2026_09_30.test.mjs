// Two retriever-side reasons an attached file never reached the prompt (2026-09-30).
//
// 1. SMALL-CORPUS ARBITRATION. buildLexicalStats() returns null below
//    IDF_MIN_POOL (12) chunks and probeAnchors returned false whenever it did —
//    so for an ordinary upload of a few pages (1–8 semantic chunks) corpus
//    arbitration could never rescue a general-looking question. Small pools are
//    now judged by the SHARE of the question's content words one chunk holds.
//    Fixtures are written as real slides / a real thesis section, not echoes of
//    the questions, so a positive cannot pass vacuously.
//
// 2. THE hybrid_threw BRANCH. A query embed that hard-fails mid-turn lands in a
//    catch that ran lexical retrieval with NO floor, and the retriever's result
//    said nothing about it (usedFallback reads false there). It now gets the
//    same floors as the embedder-unavailable branch, and reports degradedReason.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href);
const L = await dist('services/modes/lexicalTokens.js');
const { ModeHybridRetriever } = await dist('services/modes/ModeHybridRetriever.js');

const SLIDES = `BIO 201 Week 6: Cellular Respiration
Slide 1. Overview: glycolysis (cytoplasm), pyruvate oxidation, citric acid cycle, oxidative phosphorylation.
Slide 2. Glycolysis yields a net 2 ATP and 2 NADH per glucose and needs no oxygen.
Slide 3. The electron transport chain sits in the inner mitochondrial membrane. NADH and FADH2 hand their electrons to complexes I-IV, which pump protons into the intermembrane space.
Slide 4. Oxygen is the final electron acceptor: at complex IV each O2 takes four electrons and four protons to form two water molecules. Without oxygen the chain backs up and the cell falls back to fermentation.
Slide 5. ATP synthase uses the proton gradient (chemiosmosis) to make most of the cell's ATP.`;

const THESIS = [
  `4.1 Setup. We fine-tune a 300M-parameter speech encoder on 42 hours of transcribed Swahili broadcast speech. Sparse adapters of rank 8 are inserted after every feed-forward block; only 1.9% of the parameters are trained. Both models train for exactly 30,000 steps with the same schedule.`,
  `4.2 Main result. Across five runs with different random seeds, sparse adapters reach 18.4% word error rate against 21.1% for full fine-tuning. The seed-to-seed standard deviation is 0.3; a paired bootstrap test gives p < 0.01, so the gains are well outside run-to-run noise.`,
  `4.4 Limitations. All experiments use a single language and a single domain (broadcast news). A replication on Yoruba and Amharic is left for future work.`,
];

describe('small-pool corpus probe (lexicalTokens.smallPoolAnchorsQuestion)', () => {
  test('the pools under test really are below the idf floor', () => {
    assert.equal(L.buildLexicalStats([SLIDES]), null);
    assert.equal(L.buildLexicalStats(THESIS), null);
  });
  test('a lecture statement that shares the slides\' distinctive terms anchors', () => {
    assert.equal(L.smallPoolAnchorsQuestion('And the reason you can\'t skip breathing is that oxygen is the final electron acceptor', [SLIDES]), true);
  });
  test('an examiner challenge that shares the thesis\'s distinctive terms anchors', () => {
    assert.equal(L.smallPoolAnchorsQuestion('Five runs is not many. How do you know the gains are not just noise?', THESIS), true);
    assert.equal(L.smallPoolAnchorsQuestion('Why only broadcast news? Would a replication on other languages hold up?', THESIS), true);
  });
  test('unrelated general knowledge does not anchor', () => {
    for (const q of ['What is the boiling point of water?', 'What is a mutex?', 'How do I center a div in CSS?', 'Explain the CAP theorem']) {
      assert.equal(L.smallPoolAnchorsQuestion(q, [SLIDES]), false, q);
      assert.equal(L.smallPoolAnchorsQuestion(q, THESIS), false, q);
    }
  });
  test('function words and generic verbs never anchor, even though the file contains them', () => {
    assert.equal(L.smallPoolAnchorsQuestion('What is it that they did there and why does it matter?', THESIS), false);
    assert.equal(L.smallPoolAnchorsQuestion('I think people know that makes it better, right?', THESIS), false);
  });
  test('one shared content word is never enough', () => {
    assert.equal(L.smallPoolAnchorsQuestion('Tell me about oxygen masks on airplanes', [SLIDES]), false);
  });
  test('a long unrelated question sharing two common words stays general (share < 50%)', () => {
    assert.equal(L.smallPoolAnchorsQuestion('How would you structure a quarterly sales forecast for a new market with seasonal demand, limited historical data and single domain pricing?', THESIS), false);
  });
});

const db = { prepare: () => ({ get: () => null, all: () => [], run: () => {} }), exec: () => {} };
const file = (id, content) => ({ id, modeId: 'm', fileName: `${id}.md`, content, createdAt: new Date().toISOString() });

describe('ModeHybridRetriever.probeAnchors on a small file', () => {
  const r = new ModeHybridRetriever(db, {}, { isReady: () => false, getActiveProviderName: () => 'none' });
  const slides = [file('slides', SLIDES)];
  test('used to be false for any pool under 12 chunks; now judged by content-word share', () => {
    assert.equal(r.probeAnchors(slides, 'the reason you cannot skip breathing is that oxygen is the final electron acceptor'), true);
    assert.equal(r.probeAnchors(slides, 'what is the boiling point of water'), false);
  });
  test('repeat probes reuse the pool statistics while the file is unchanged', () => {
    r.probeAnchors(slides, 'oxygen electron acceptor');
    const cached = r.probePoolCache;
    r.probeAnchors(slides, 'glycolysis ATP yield');
    assert.equal(r.probePoolCache, cached);
  });
  test('no files → false', () => assert.equal(r.probeAnchors([], 'oxygen electron acceptor'), false));
});

describe('a query embed that hard-fails mid-turn (hybrid_threw)', () => {
  const failing = {
    isReady: () => true,
    getActiveProviderName: () => 'natively',
    getActiveSpaceKey: () => 'natively:voyage-4:2048',
    getEmbedding: async () => [0.1, 0.2, 0.3],
    getEmbeddingForQuery: async () => { throw new Error('embedQuery() timed out after 3000ms'); },
  };
  const r = new ModeHybridRetriever(db, {}, failing);
  test('the fixture is below the lexical threshold on its own', () => {
    const q = new Set(L.wordsOf('hypoxia during sprinting lowers aerobic metabolism oxygen'));
    const c = new Set(L.wordsOf(SLIDES));
    const hits = [...q].filter((w) => c.has(w)).length;
    assert.equal(hits, 1);
    assert.ok(hits / Math.sqrt(q.size * c.size) < 0.06);
  });
  test('still returns the best-overlapping chunks and says it was degraded', async () => {
    const res = await r.retrieve({
      // ONE shared word ("oxygen") against a ~100-word chunk scores ~0.04, under
      // the 0.06 lexical threshold: without the floor this returned nothing.
      query: 'hypoxia during sprinting lowers aerobic metabolism oxygen', modeId: 'm', files: [file('slides', SLIDES)],
      tokenBudget: 2000, topK: 8, hasTranscript: false, forceDocumentGrounding: true,
    });
    assert.equal(res.degradedReason, 'hybrid_threw');
    assert.ok(res.chunks.length > 0, 'the lexical floor keeps a positive-overlap chunk instead of handing over nothing');
  });
  test('an embedder that was never available reports embedding_unavailable', async () => {
    const off = new ModeHybridRetriever(db, {}, { isReady: () => false, getActiveProviderName: () => 'none' });
    const res = await off.retrieve({ query: 'oxygen electron acceptor', modeId: 'm', files: [file('slides', SLIDES)], tokenBudget: 2000, topK: 8, hasTranscript: false });
    assert.equal(res.degradedReason, 'embedding_unavailable');
  });
});
