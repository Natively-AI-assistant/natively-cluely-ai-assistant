// benchmarks/reranker-eval/lib/candidates.mjs
//
// For every query: chunk every document, embed every chunk + the query,
// rank all chunks (across ALL documents, not just the gold one — this is
// the realistic hard case where distractor chunks from OTHER documents
// compete) by cosine similarity, cap at the same RERANK_CANDIDATE_POOL=30
// production uses (electron/services/modes/ModeHybridRetriever.ts), and
// resolve the gold chunk index/indices via keyword matching.
import { chunkDocument } from './chunk.mjs';
import { cosineSimilarity } from './embedder.mjs';

const RERANK_CANDIDATE_POOL = 30; // matches ModeHybridRetriever.ts

export async function buildCandidatePools(repoRoot, documents, queries, embedder) {
  // Chunk every document once, embed every chunk once.
  const allChunks = []; // { docId, chunkIndex, text, embedding }
  for (const doc of documents) {
    const chunks = await chunkDocument(repoRoot, doc.text);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedder.embed(chunks[i]);
      allChunks.push({ docId: doc.id, chunkIndex: i, text: chunks[i], embedding });
    }
  }

  const results = [];
  for (const q of queries) {
    const queryEmbedding = await embedder.embed(q.query);
    const scored = allChunks.map((c) => ({
      docId: c.docId,
      chunkIndex: c.chunkIndex,
      text: c.text,
      cosineScore: cosineSimilarity(queryEmbedding, c.embedding),
    }));
    scored.sort((a, b) => b.cosineScore - a.cosineScore);
    const pool = scored.slice(0, RERANK_CANDIDATE_POOL);

    // Resolve gold chunk indices WITHIN THE POOL (a chunk that didn't even
    // make the pool can't be ranked — that's a distinct failure mode this
    // harness reports separately, not silently ignored).
    const goldChunkPoolIndices = [];
    pool.forEach((c, poolIdx) => {
      if (c.docId !== q.goldDocumentId) return;
      const isGold = q.goldChunkKeywords.every((kw) => c.text.includes(kw));
      if (isGold) goldChunkPoolIndices.push(poolIdx);
    });

    results.push({
      queryId: q.id,
      query: q.query,
      goldDocumentId: q.goldDocumentId,
      goldChunkPoolIndices, // empty array means the gold chunk missed the pool entirely
      pool,
    });
  }
  return results;
}
