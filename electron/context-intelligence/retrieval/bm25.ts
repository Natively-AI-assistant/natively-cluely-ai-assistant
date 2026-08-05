// electron/context-intelligence/retrieval/bm25.ts
//
// Okapi BM25 — the measured highest-leverage retrieval change available.
//
// WHY THIS EXISTS
// The shipped retriever advertises "FTS/BM25" but computes
//     matches / sqrt(|Q| * |uniqueChunkWords|)
// over DE-DUPLICATED matches: no term frequency, no IDF, no document-length
// prior. There is also no FTS5 table anywhere under electron/ (verified: zero
// hits for FTS5 / "USING fts").
//
// Phase 2 measured both on the identical candidate pool, corpus and questions,
// with ranking as the only difference:
//
//     shipped "FTS" scorer   R@1 40.0   R@3 70.0   P@3 25.3
//     real BM25              R@1 63.3   R@3 80.0   P@3 30.7
//
// +23.3 points of Recall@1, at 11 ms p50. Real BM25 also beat pure semantic at
// R@1 (63.3 vs 60.0) with less than half the stale-version rate (23.8 vs 54.8).
//
// See docs/context-intelligence-v3/02_RETRIEVAL_BENCHMARK.md §6.1

/** Must stay identical to the legacy tokenizer so lexical scores stay comparable
 *  across the migration (ModeHybridRetriever.wordsOf). Guarded by a parity test. */
export function tokenize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export interface Bm25Params {
  /** Term-frequency saturation. 1.2–2.0 is the usual range. */
  k1: number;
  /** Length normalisation. 0 = none, 1 = full. */
  b: number;
}

export const DEFAULT_BM25: Bm25Params = { k1: 1.5, b: 0.75 };

export interface Bm25Doc {
  id: string;
  text: string;
}

export interface Bm25Scored {
  id: string;
  score: number;
}

/**
 * A prepared index over a candidate set. Built per query-batch rather than
 * persisted: the candidate pool is already scoped and version-filtered by the
 * time it reaches here, and IDF must be computed over THAT pool to be meaningful
 * — computing it over the whole corpus would let out-of-scope documents
 * influence in-scope ranking.
 */
export class Bm25Index {
  private readonly docs: Array<{ id: string; tf: Map<string, number>; len: number }> = [];
  private readonly df = new Map<string, number>();
  private avgdl = 1;

  constructor(docs: Bm25Doc[], private readonly params: Bm25Params = DEFAULT_BM25) {
    let total = 0;
    for (const d of docs) {
      const terms = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: terms.length });
      total += terms.length;
    }
    this.avgdl = this.docs.length ? total / this.docs.length : 1;
  }

  /** Robertson/Sparck-Jones IDF with +0.5 smoothing, floored at 0 so a term
   *  present in every document contributes nothing rather than going negative. */
  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length || 1;
    return Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  score(query: string): Bm25Scored[] {
    const { k1, b } = this.params;
    const qTerms = tokenize(query);
    const out: Bm25Scored[] = [];

    for (const d of this.docs) {
      let score = 0;
      for (const t of qTerms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const norm = 1 - b + b * (d.len / (this.avgdl || 1));
        score += this.idf(t) * ((f * (k1 + 1)) / (f + k1 * norm));
      }
      out.push({ id: d.id, score });
    }
    return out.sort((x, y) => y.score - x.score);
  }

  /** Min-max normalise to [0,1] so BM25 can be fused with cosine similarity.
   *  BM25 is unbounded, so raw fusion with a bounded signal would let one query's
   *  score magnitude dominate another's. */
  scoreNormalized(query: string): Bm25Scored[] {
    const scored = this.score(query);
    const max = scored.length ? scored[0].score : 0;
    if (max <= 0) return scored.map((s) => ({ ...s, score: 0 }));
    return scored.map((s) => ({ ...s, score: s.score / max }));
  }
}
