// electron/services/modes/rerankPool.ts
//
// Which candidates the cross-encoder gets to see.
//
// MEASURED 2026-09-07 (General mode, six attached files, one of them 420 KB of
// 600 near-identical padding records; Voyage rerank-2.5-lite, pool 30): for
// "find every place a latency number appears", the hybrid lexical+vector
// pre-rank put THIRTY padding chunks above every chunk of the five small files
// — the padding all says "latency budget" and "metrics". The reranker never
// saw the résumé metrics, the anchor sheet or the PERFORMANCE-301 numbers; they
// reached the answer only through the per-file selection floor, unreranked and
// sorted last. A reranker can only fix an ordering it is shown.
//
// So the pool is built with a per-file floor BEFORE the global fill: every
// attached file gets its best `perFileFloor` chunks into the pool, then the
// remaining slots fill by hybrid order. The pool SIZE is unchanged (cost is
// the same); only its composition is. For an exhaustive request the floor is
// balanced across files; for an ordinary turn it is one chunk per file, so a
// single-topic question in a many-file mode still spends most of its pool on
// the file that dominates.

export interface PoolCandidate { sourceId: string }

export function buildRerankPool<T extends PoolCandidate>(
    sorted: readonly T[],
    poolSize: number,
    opts: { balanced?: boolean } = {},
): T[] {
    const size = Math.max(0, Math.min(sorted.length, Math.floor(poolSize)));
    if (size === 0) return [];
    const byFile = new Map<string, T[]>();
    for (const c of sorted) {
        const list = byFile.get(c.sourceId);
        if (list) list.push(c);
        else byFile.set(c.sourceId, [c]);
    }
    if (byFile.size <= 1) return sorted.slice(0, size);

    const floor = opts.balanced
        ? Math.max(1, Math.ceil(size / byFile.size))
        : 1;
    const picked = new Set<T>();
    const pool: T[] = [];
    // Round-robin so every file gets its FIRST pick before any file gets its
    // second — a global walk would let one file's floor consume the pool.
    for (let round = 0; round < floor && pool.length < size; round++) {
        for (const list of byFile.values()) {
            if (pool.length >= size) break;
            const c = list[round];
            if (c && !picked.has(c)) { picked.add(c); pool.push(c); }
        }
    }
    for (const c of sorted) {
        if (pool.length >= size) break;
        if (!picked.has(c)) { picked.add(c); pool.push(c); }
    }
    // Keep hybrid order inside the pool: the reranker re-scores everything,
    // and a reranker that fails leaves the caller with the pre-rerank order.
    const index = new Map<T, number>(sorted.map((c, i) => [c, i] as const));
    pool.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
    return pool;
}
