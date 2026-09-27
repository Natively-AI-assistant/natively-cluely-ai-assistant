// Retrieval-scale campaign, 2026-09-19. Measured with experiments/retrieval-scale
// (real retriever + V3 port + packer over generated 5k–70k-token fixtures):
// on a long document made of same-shaped sections, an exact lookup —
// "Who leads the Eyrie pod 13?" — ranked the section that answers it 101st of
// 397. Three causes, each pinned below:
//
//   1. the tokenizer dropped "13" (every token of 1–2 characters), the only
//      term separating the section from its siblings;
//   2. the lexical score weighed "the" and "pod" the same as "Eyrie";
//   3. with both fixed the section had the TOP lexical score and still lost,
//      because cosine similarity across sibling sections is noise carrying 0.6
//      of the blend.
//
// Plus the lexical branch (key-less users) sent a mostly empty evidence budget
// when only one or two chunks cleared the floor.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The mock db persists nothing, so every chunk is embedded on the query path.
// Above QUERY_EPHEMERAL_EMBED_MAX (24, read at module load) the retriever
// scores the whole file lexically — which would make the adversarial-vector
// test below pass without a vector ever being compared. Lift the cap BEFORE
// the module is imported; the test then asserts the arm was live.
process.env.NATIVELY_QUERY_EPHEMERAL_EMBED_MAX = '5000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href);
const { ModeHybridRetriever } = await dist('services/modes/ModeHybridRetriever.js');
const { wordsOf, keepToken, buildLexicalStats, queryWeights, weightedOverlapScore, anchorTerms, anchorCoverage, IDF_MIN_POOL } = await dist('services/modes/lexicalTokens.js');
const { tokenize } = await dist('context-intelligence/retrieval/bm25.js');

const NAMES = ['Anneke Pettersson', 'Hamid Kovalenko', 'Greta Novak', 'Otto Szabo', 'Priya Mbeki', 'Ilse Eklund', 'Dmitri Okafor', 'Tamsin Quigley'];
const CODES = ['Eyrie', 'Alder', 'Nimbus', 'Fathom', 'Basalt'];
// 60 sibling sections. Codenames repeat, so "Eyrie" alone matches 12 of them;
// only the pod number pins one. Each is long enough to be its own chunk.
// Headcounts are 104–112 on purpose: with 4–12, section 15 read "has 10
// engineers" and matched "Eyrie" + "10" as a bag of words exactly as well as
// pod 10 does. That collision is a real limit, pinned as a todo below.
const section = (i) => [
  `### Team profile: Payments Edge (${CODES[i % CODES.length]} pod ${i})`,
  '',
  '**Overview**',
  '',
  `The pod owns the notification fan-out and the audit trail. It is led by ${NAMES[i % NAMES.length]} and currently has ${104 + (i % 9)} engineers.`,
  '',
  '**What you would do here**',
  '',
  ...Array.from({ length: 6 }, (_, b) => `- Migrate the report scheduler using Kafka and Redis, with a target of moving p99 latency by ${11 + ((i * 7 + b) % 60)}%, working with the platform group on rollout ${i}-${b} and documenting the result for other squads.`),
  '',
].join('\n');
const DOC = '# Job description\n\n' + Array.from({ length: 60 }, (_, i) => section(i)).join('\n');
const FILES = [{ id: 'jd', modeId: 'm', fileName: 'jd.md', content: DOC, createdAt: new Date().toISOString() }];
const TARGET = '(Eyrie pod 10)';

const db = () => ({ prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) });
const vectorStore = { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) };

function lexicalRetriever() {
  return new ModeHybridRetriever(db(), vectorStore, {
    isReady: () => false, getActiveProviderName: () => 'natively', getActiveSpaceKey: () => 'natively:x:4',
    getEmbeddingForQuery: () => Promise.reject(new Error('no embed')), getEmbeddingsWithFallback: () => Promise.reject(new Error('no embed')), getEmbedding: () => Promise.reject(new Error('no embed')),
  });
}

// A vector arm that prefers the WRONG sections. `gap` is how much closer the
// siblings sit to the query than the target does. The measured arm (MiniLM,
// 338 same-shaped sections) was noise of this shape: siblings 0.33, target 0.20.
const unit = (cos) => [cos, Math.sqrt(1 - cos * cos), 0, 0];
function skewedVectorRetriever({ sibling, target }) {
  const q = [1, 0, 0, 0];
  return new ModeHybridRetriever(db(), vectorStore, {
    isReady: () => true, getActiveProviderName: () => 'natively', getActiveSpaceKey: () => 'natively:x:4',
    getActiveProviderMaxBatch: () => 1000,
    getEmbeddingForQuery: () => Promise.resolve(q), getEmbedding: () => Promise.resolve(q),
    getEmbeddingsWithFallback: (texts) => Promise.resolve({ embeddings: texts.map((t) => unit(t.includes(TARGET) ? target : sibling)), space: 'natively:x:4' }),
  });
}

describe('tokenizer: a short token with a digit is an identifier', () => {
  test('pod numbers, step numbers and version tags survive; two-letter words do not', () => {
    const w = wordsOf('Who is the lead of the Eyrie pod 13, step 6 of v2 at L5?', { shortNumerics: true });
    for (const t of ['13', '6', 'v2', 'l5', 'eyrie', 'pod']) assert.ok(w.includes(t), `missing ${t}: ${w}`);
    for (const t of ['is', 'of', 'at']) assert.ok(!w.includes(t), `kept ${t}`);
    assert.equal(keepToken('13'), true);
    assert.equal(keepToken('of'), false);
  });
  test('the numeric tail of a hyphenated identifier is a sub-token', () => {
    assert.ok(wordsOf('atlas-gateway-86 availability', { shortNumerics: true }).includes('86'));
  });
  test('the default tokenizer is unchanged — the legacy retriever has no idf to discount a numeral', () => {
    const w = wordsOf('Eyrie pod 13, step 6 of atlas-gateway-86');
    for (const t of ['13', '6', '86']) assert.ok(!w.includes(t), `default tokenizer kept ${t}`);
    assert.ok(w.includes('eyrie') && w.includes('atlas-gateway-86'));
  });
  test('the BM25 tokenizer stays in lockstep (profile port)', () => {
    assert.deepEqual(tokenize('Eyrie pod 13 of v2'), ['eyrie', 'pod', '13', 'v2']);
  });
});

describe('corpus-weighted lexical score', () => {
  test('below IDF_MIN_POOL there are no statistics — the legacy score stands', () => {
    assert.equal(buildLexicalStats(Array.from({ length: IDF_MIN_POOL - 1 }, (_, i) => `chunk ${i} text`)), null);
  });
  test('equal weights reduce to the legacy overlap formula exactly', () => {
    // Every term appears in exactly one chunk => every idf is identical.
    const texts = Array.from({ length: 12 }, (_, i) => `alpha${i} beta${i} gamma${i}`);
    const stats = buildLexicalStats(texts);
    const q = queryWeights(new Set(['alpha3', 'beta3', 'zzz9']), stats);
    const got = weightedOverlapScore(q, stats.sets[3], stats.norms[3]);
    assert.ok(Math.abs(got - 2 / Math.sqrt(3 * 3)) < 1e-9, `got ${got}`);
  });
  test('a term in every chunk carries almost no weight; the rare one carries the score', () => {
    const texts = Array.from({ length: 40 }, (_, i) => `the pod owns the audit trail section${i}` + (i === 7 ? ' quasar' : ''));
    const stats = buildLexicalStats(texts);
    const q = queryWeights(new Set(['the', 'pod', 'quasar']), stats);
    const hit = weightedOverlapScore(q, stats.sets[7], stats.norms[7]);
    const miss = weightedOverlapScore(q, stats.sets[8], stats.norms[8]);
    assert.ok(hit > 5 * miss, `rare-term chunk ${hit} vs stopword-only chunk ${miss}`);
    assert.ok(hit <= 1 && miss >= 0);
  });
  test('anchors are the rare query terms; coverage is their idf-weighted share', () => {
    const texts = Array.from({ length: 60 }, (_, i) => `team pod ${i} ${CODES[i % 5].toLowerCase()} led by someone`);
    const stats = buildLexicalStats(texts);
    const anchors = anchorTerms(new Set(wordsOf('who leads the eyrie pod 10', { shortNumerics: true })), stats);
    assert.ok(anchors.has('10'), [...anchors.keys()].join(','));
    assert.ok(!anchors.has('pod') && !anchors.has('the'));
    assert.equal(anchorCoverage(anchors, stats.sets[10]), 1);
    assert.equal(anchorCoverage(new Map(), stats.sets[10]), 0);
  });
});

describe('an exact lookup among 60 same-shaped sections', () => {
  const QUERY = 'Who leads the Eyrie pod 10?';
  test('lexical branch: the named section is the top chunk', async () => {
    const r = await lexicalRetriever().retrieve({ query: QUERY, modeId: 'm', files: FILES, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true });
    assert.ok(r.chunks.length > 0);
    assert.ok(r.chunks[0].text.includes(TARGET), `top chunk: ${r.chunks[0].text.slice(0, 90)}`);
  });
  test('hybrid branch: vector noise across siblings cannot bury the section that holds every rare term', async () => {
    const hr = skewedVectorRetriever({ sibling: 0.33, target: 0.20 });
    const r = await hr.retrieve({ query: QUERY, modeId: 'm', files: FILES, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: false });
    const at = r.chunks.findIndex((c) => c.text.includes(TARGET));
    assert.equal(at, 0, `target rank ${at} of ${r.chunks.length}`);
    // Not vacuous: the vector arm ran, and it really did prefer the siblings.
    assert.equal(r.usedHybrid, true, 'hybrid branch must have run');
    const sibling = r.chunks.find((c) => !c.text.includes(TARGET));
    assert.ok(Math.abs(r.chunks[at].vectorScore - 0.20) < 0.01, `target cosine ${r.chunks[at].vectorScore}`);
    assert.ok(sibling && Math.abs(sibling.vectorScore - 0.33) < 0.01, `sibling cosine ${sibling?.vectorScore}`);
    // The score handed downstream carries the anchor: V3 re-sorts by it.
    assert.ok(r.chunks[at].anchorScore > 0.2, `anchorScore ${r.chunks[at].anchorScore}`);
    assert.ok(r.chunks[at].score > sibling.score, `reported ${r.chunks[at].score} vs sibling ${sibling.score}`);
  });
  test('the anchor is a tiebreak inside the noise band, NOT an override of a confident vector arm', async () => {
    // A 0.8 cosine gap is not noise — it is the embedder saying the siblings
    // are about the question and the target is not. Sizing the boost to beat
    // that would let one incidental rare word outrank a strong semantic match
    // on every paraphrased question. Pinned so the boost is not "fixed" upward.
    const hr = skewedVectorRetriever({ sibling: 1.0, target: 0.20 });
    const r = await hr.retrieve({ query: QUERY, modeId: 'm', files: FILES, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: false });
    assert.equal(r.usedHybrid, true);
    assert.ok(!r.chunks[0].text.includes(TARGET), 'a confident vector arm still leads');
  });
});

describe('known limit: anchors are a bag of words', () => {
  // "Eyrie pod 15 … has 10 engineers" holds both anchor terms of "Eyrie pod 10".
  // Telling them apart needs phrase proximity ("pod 10" adjacent), which the
  // scorer does not have. Left as a todo so the gap is visible, not hidden by
  // a convenient fixture.
  test('a sibling that holds the same terms non-adjacently does not outrank the named section', { todo: 'needs a proximity/bigram signal' }, async () => {
    const collide = (i) => section(i).replace(/has \d+ engineers/, i === 15 ? 'has 10 engineers' : '$&');
    const doc = '# Job description\n\n' + Array.from({ length: 60 }, (_, i) => collide(i)).join('\n');
    const hr = skewedVectorRetriever({ sibling: 0.33, target: 0.20 });
    const r = await hr.retrieve({ query: 'Who leads the Eyrie pod 10?', modeId: 'm', files: [{ ...FILES[0], content: doc }], tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: false });
    assert.ok(r.chunks[0].text.includes(TARGET), r.chunks[0].text.slice(0, 80));
  });
});

describe('lexical branch fills a thin result', () => {
  // "quasar" pins exactly one chunk. "pod" and "engineers" are in every
  // sibling, so under corpus weighting they are worth almost nothing and the
  // siblings fall below the admission floor: ONE chunk clears it. The siblings
  // still share a token with the question, which is what the top-up requires —
  // it never adds a chunk with zero overlap (pinned in
  // ModeHybridLexicalFloor2026_09_11).
  const doc = DOC + '\n### Escalation policy\n\nIf a Quasar page is unacknowledged for 12 minutes, page the Tier-2 lead.\n';
  const files = [{ ...FILES[0], content: doc }];
  test('one chunk over the floor is topped up instead of sending a near-empty budget', async () => {
    const r = await lexicalRetriever().retrieve({ query: 'quasar escalation for the pod engineers', modeId: 'm', files, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true });
    assert.ok(r.chunks[0].text.includes('Quasar'), r.chunks[0].text.slice(0, 80));
    assert.ok(r.chunks.length >= 3, `only ${r.chunks.length} chunk(s) sent with budget to spare`);
  });
  test('a question sharing no token with the rest of the corpus is NOT padded', async () => {
    const r = await lexicalRetriever().retrieve({ query: 'quasar escalation who do we page', modeId: 'm', files, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true });
    assert.equal(r.chunks.length, 1, `${r.chunks.length} chunks`);
    assert.ok(r.chunks[0].text.includes('Quasar'));
  });
});

describe('rank fusion: a weak cross-encoder cannot bury the first stage\'s exact match', () => {
  // A reranker that is WRONG about the target: it scores the first-stage
  // leader last and everything else in pool order. The measured bundled model
  // did the mild version of this (1st → 6th–9th) on sibling sections.
  // The bar is the evidence cap (maximumAcceptedEvidence = 6), because that is
  // the cut the measured failures died at — not an arbitrary "top 3". Probed:
  // with the target scored last in its rerank batch, replace leaves it 25th of
  // 61 and fusion 4th.
  const EVIDENCE_CAP = 6;
  const QUERY = 'Who leads the Eyrie pod 10?';
  const buryTarget = { rerank: async (_q, passages) => passages
    .map((t, index) => ({ index, score: t.includes(TARGET) ? -5 : 5 - index * 0.01 }))
    .sort((a, b) => b.score - a.score) };
  const run = async () => {
    const hr = skewedVectorRetriever({ sibling: 0.33, target: 0.20 });
    hr.__setRerankerForTests(buryTarget);
    const r = await hr.retrieve({ query: QUERY, modeId: 'm', files: FILES, tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: true, rerankSurface: 'manual' });
    return { r, at: r.chunks.findIndex((c) => c.text.includes(TARGET)) };
  };
  test('replace (fusion off): the reranker\'s verdict stands alone and the target sinks', async () => {
    process.env.NATIVELY_RERANK_FUSION = 'off';
    try {
      const { r, at } = await run();
      assert.ok(r.chunks.some((c) => typeof c.rerankScore === 'number'), 'the rerank must actually have run');
      assert.ok(at === -1 || at >= EVIDENCE_CAP, `target rank ${at} of ${r.chunks.length}`);
    } finally { delete process.env.NATIVELY_RERANK_FUSION; }
  });
  test('fused: first-stage rank 1 + rerank rank last stays inside the evidence cap', async () => {
    process.env.NATIVELY_RERANK_FUSION = 'rrf';
    try {
      const { r, at } = await run();
      assert.ok(r.chunks.some((c) => typeof c.rerankScore === 'number'), 'the rerank must actually have run');
      assert.ok(at >= 0 && at < EVIDENCE_CAP, `target rank ${at} of ${r.chunks.length}`);
    } finally { delete process.env.NATIVELY_RERANK_FUSION; }
  });
  test('an injected / hosted reranker is NOT fused by default (only the built-in local model is)', async () => {
    delete process.env.NATIVELY_RERANK_FUSION;
    const { at } = await run();
    assert.ok(at === -1 || at >= EVIDENCE_CAP, `target rank ${at}: default fusion leaked onto a non-built-in reranker`);
  });
});
