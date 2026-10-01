// benchmarks/reranker-eval/lib/metrics.mjs

export function reciprocalRank(rankedGoldFlags) {
  const idx = rankedGoldFlags.findIndex(Boolean);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

export function recallAtK(rankedGoldFlags, k) {
  return rankedGoldFlags.slice(0, k).some(Boolean) ? 1 : 0;
}

export function ndcgAtK(rankedGoldFlags, k) {
  const slice = rankedGoldFlags.slice(0, k);
  const totalRelevant = rankedGoldFlags.filter(Boolean).length;
  if (totalRelevant === 0) return 0;

  let dcg = 0;
  slice.forEach((isGold, i) => {
    if (isGold) dcg += 1 / Math.log2(i + 2); // i is 0-indexed; rank is i+1, log2(rank+1)
  });

  // Ideal DCG: all relevant items (up to k, up to totalRelevant) packed at the top.
  const idealCount = Math.min(k, totalRelevant);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);

  return idcg === 0 ? 0 : dcg / idcg;
}

export function aggregateMetrics(perQuery) {
  if (perQuery.length === 0) return { mrr: 0, recallAt1: 0, recallAt3: 0, ndcg: 0 };
  const sum = perQuery.reduce(
    (acc, q) => ({
      mrr: acc.mrr + q.mrr,
      recallAt1: acc.recallAt1 + q.recallAt1,
      recallAt3: acc.recallAt3 + q.recallAt3,
      ndcg: acc.ndcg + q.ndcg,
    }),
    { mrr: 0, recallAt1: 0, recallAt3: 0, ndcg: 0 },
  );
  const n = perQuery.length;
  return { mrr: sum.mrr / n, recallAt1: sum.recallAt1 / n, recallAt3: sum.recallAt3 / n, ndcg: sum.ndcg / n };
}
