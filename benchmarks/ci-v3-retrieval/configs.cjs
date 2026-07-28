/**
 * Phase 2 bake-off — configuration runners.
 *
 * Configs 1, 2 and 4 are NOT three retrievers. They are three rankings of one
 * candidate pool. The isolation point is a direct call to performHybridRetrieval
 * with the score floor removed; re-ranking retrieve()'s public output would be
 * biased because that path applies an adaptive floor derived from
 * MIN_COMBINED_SCORE = 0.15, dropping chunks that would top pure-vector.
 * See docs/context-intelligence-v3/02_RETRIEVAL_BENCHMARK.md §4A.3.
 */
'use strict';

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');
const d = (rel) => require(path.join(DIST, rel));

// Must match ModeHybridRetriever.wordsOf (ts:157-165) EXACTLY — it is module
// private, so it is replicated here. Divergence would silently change every
// lexical score. Guarded by assertTokenizerParity() below.
function wordsOf(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

const FTS_WEIGHT = 0.4; // ModeHybridRetriever.ts:98

function makeRetriever({ db, raw, vectorStore, pipe }) {
  const { ModeHybridRetriever } = d('electron/services/modes/ModeHybridRetriever.js');
  // Takes the RAW better-sqlite3 handle (ts:224 `db: Database.Database`), NOT the
  // DatabaseManager wrapper — mirrors ModeContextRetriever.ts:1709. Passing the
  // wrapper makes this.db.exec() fail inside native code and abort the process
  // with SIGTRAP rather than throwing a catchable JS error.
  const handle = raw || (db && typeof db.getDb === 'function' ? db.getDb() : db);
  if (!handle || typeof handle.prepare !== 'function') {
    throw new Error('makeRetriever: expected a raw sqlite handle');
  }
  const hr = new ModeHybridRetriever(handle, vectorStore, pipe);
  return { hr, P: Object.getPrototypeOf(hr) };
}

/**
 * Parity guard: our replicated tokenizer must produce the same lexical score as
 * the retriever's own computeFtsScore for a known input. If this drifts, every
 * config-2 number is wrong and we want a hard failure, not silent skew.
 */
function assertTokenizerParity({ P, hr }) {
  const chunk = 'The Mercury X1 robot operates at a working voltage of 48V';
  const q = new Set(wordsOf('what working voltage is listed for Mercury X1'));
  const score = P.computeFtsScore.call(hr, chunk, q);
  if (!(score > 0)) throw new Error('VOID: tokenizer parity check produced a zero lexical score');
  return score;
}

/**
 * Build the UNFILTERED candidate pool once per query. Floor must be -Infinity,
 * not 0: cosine can be negative and 0 would clip legitimate candidates.
 */
async function buildPool({ hr, P }, files, query) {
  const candidates = P.getModeFileChunks.call(hr, files);
  const queryWords = new Set(wordsOf(query));
  const pool = await P.performHybridRetrieval.call(hr, candidates, queryWords, query, -Infinity, files);
  return pool;
}

const combined = ({ P, hr }, c) => P.combinedScore.call(hr, c.ftsScore || 0, c.vectorScore || 0, FTS_WEIGHT);

/**
 * Config 2b — a REAL BM25, introduced for this benchmark.
 *
 * Necessary because the repository has no BM25 and no full-text index: the
 * retriever that advertises "FTS/BM25" computes matches/sqrt(|Q|*|uniqueWords|)
 * with de-duplicated matches — no term frequency, no IDF, no length prior.
 * Measuring that as the keyword incumbent would answer §8.4 with a fact about a
 * mislabelled component rather than about keyword retrieval.
 *
 * Standard Robertson/Sparck-Jones BM25 with the usual k1=1.5, b=0.75.
 */
function bm25Rank(pool, query, { k1 = 1.5, b = 0.75 } = {}) {
  const docs = pool.map((c) => wordsOf(c.text));
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);

  const qTerms = wordsOf(query);
  const scores = pool.map((c, i) => {
    const d = docs[i];
    const dl = d.length || 1;
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const t of qTerms) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const n = df.get(t) || 0;
      // idf with the +0.5 smoothing; floored at 0 so a term present in every
      // document contributes nothing rather than going negative.
      const idf = Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
    }
    return { c, score };
  });

  return scores.sort((x, y) => y.score - x.score).map((s) => s.c);
}

/** Three rankings of one pool. Returns ranked candidate arrays. */
const RANKERS = {
  // Config 1 — semantic vector only
  '1_semantic': (ctx, pool) => [...pool].sort((a, b) => (b.vectorScore || 0) - (a.vectorScore || 0)),
  // Config 2a — the EXISTING "FTS" scorer. Verified as normalised unique-term
  // overlap: matches / sqrt(|Q| * |uniqueChunkWords|). No term frequency, no
  // IDF, no length prior. It is NOT BM25 and must not be labelled as such.
  '2a_lexical_overlap': (ctx, pool) => [...pool].sort((a, b) => (b.ftsScore || 0) - (a.ftsScore || 0)),
  // Config 2b — genuine BM25 (see bm25Rank). Needs the query text, so RANKERS
  // callbacks receive it as a third argument.
  '2b_real_bm25': (ctx, pool, query) => bm25Rank(pool, query),
  // Config 4 — hybrid, the production weighting (fake-FTS + vector)
  '4_hybrid': (ctx, pool) => [...pool].sort((a, b) => combined(ctx, b) - combined(ctx, a)),
  // Config 4b — the same hybrid shape with the lexical arm swapped for real
  // BM25. Isolates how much of hybrid's deficit is the mislabelled scorer.
  // BM25 is unbounded, so it is min-max normalised per query before fusing;
  // vectorScore is already ~[0,1] cosine.
  '4b_hybrid_bm25': (ctx, pool, query) => {
    const ranked = bm25Rank(pool, query);
    const bm = new Map();
    ranked.forEach((c, i) => bm.set(c, ranked.length - i));
    const max = ranked.length || 1;
    return [...pool].sort((a, b) => {
      const sa = FTS_WEIGHT * ((bm.get(a) || 0) / max) + (1 - FTS_WEIGHT) * (a.vectorScore || 0);
      const sb = FTS_WEIGHT * ((bm.get(b) || 0) / max) + (1 - FTS_WEIGHT) * (b.vectorScore || 0);
      return sb - sa;
    });
  },
};

module.exports = { makeRetriever, buildPool, RANKERS, wordsOf, assertTokenizerParity, combined, FTS_WEIGHT, bm25Rank };
