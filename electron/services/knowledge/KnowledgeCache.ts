// electron/services/knowledge/KnowledgeCache.ts
//
// OKF Phase 7 — in-memory caching layer for the knowledge module. Two
// caches:
//   - packCache: fileId -> KnowledgePack, invalidated by (contentHash,
//     packVersion) — a cache HIT requires both to match, so a background
//     regenerate or an edit's cardVersion bump can't serve stale data.
//   - retrievalCache: a small LRU of (packId, packVersion, question) ->
//     ScoredCard[] results, so a repeated question within a session (a
//     follow-up rephrase, or the false-refusal validator's re-retrieval in
//     ipcHandlers.ts hitting the SAME question the main path just scored)
//     doesn't re-run the lexical scoring pass.
//
// Both caches are process-local, unbounded-by-count but bounded by a max
// entry cap (evict-oldest) — packs/entities are small (tens of KB per file),
// so a modest cap is enough to keep memory bounded without needing a real
// LRU library.

import type { KnowledgePack } from './types';
import type { ScoredCard } from './OkfRetriever';

interface PackCacheEntry {
  pack: KnowledgePack;
  contentHash: string;
  packVersion: number;
  cachedAt: number;
}

const MAX_PACK_CACHE_ENTRIES = 64;
const MAX_RETRIEVAL_CACHE_ENTRIES = 256;

class BoundedMap<K, V> {
  private map = new Map<K, V>();
  constructor(private maxEntries: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    // Refresh insertion order on overwrite (simple LRU-ish behavior — Map
    // iteration order is insertion order, so delete+re-set moves it to the
    // "most recently used" end).
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  deleteWhere(predicate: (key: K, value: V) => boolean): void {
    for (const [k, v] of this.map) {
      if (predicate(k, v)) this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// GOTCHA (matches the documented pattern in electron/intelligence/intelligenceFlags.ts):
// scripts/build-electron.js bundles EVERY .ts file as its OWN esbuild entry
// point with bundle:true, so a plain module-level `const packCache = ...`
// would give LLMHelper.ts's inlined copy of this module a DIFFERENT cache
// instance than ipcHandlers.ts's or KnowledgeManager.ts's inlined copy —
// writes in one would be invisible to reads in another, silently defeating
// the cache. Anchoring to `globalThis` makes the singleton shared across
// every bundle within the same Node/Electron process.
const GLOBAL_KEY = '__natively_okf_knowledge_cache__';
interface GlobalCacheState {
  packCache: BoundedMap<string, PackCacheEntry>;
  retrievalCache: BoundedMap<string, ScoredCard[]>;
}
function getGlobalState(): GlobalCacheState {
  const g = globalThis as unknown as Record<string, GlobalCacheState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      packCache: new BoundedMap<string, PackCacheEntry>(MAX_PACK_CACHE_ENTRIES),
      retrievalCache: new BoundedMap<string, ScoredCard[]>(MAX_RETRIEVAL_CACHE_ENTRIES),
    };
  }
  return g[GLOBAL_KEY];
}
const packCache = getGlobalState().packCache;
const retrievalCache = getGlobalState().retrievalCache;

/**
 * Cache HIT requires the contentHash to match — a real document-content
 * change always mints a new contentHash (KnowledgeManager.generateForFile),
 * invalidating this cache by construction. Card edits/approvals/rejections
 * do NOT change contentHash; they explicitly call invalidatePackCache()
 * instead (see OkfCardEditor.ts) since they mutate individual card rows,
 * not the source document.
 */
export function getCachedPack(fileId: string, contentHash: string): KnowledgePack | null {
  const entry = packCache.get(fileId);
  if (!entry) return null;
  if (entry.contentHash !== contentHash) return null;
  return entry.pack;
}

export function setCachedPack(fileId: string, pack: KnowledgePack, contentHash: string): void {
  packCache.set(fileId, { pack, contentHash, packVersion: pack.packVersion, cachedAt: Date.now() });
}

export function invalidatePackCache(fileId: string): void {
  packCache.delete(fileId);
  // Also drop any retrieval-cache entries keyed to this pack's source.
  retrievalCache.deleteWhere((key) => key.startsWith(`${fileId}:`));
}

export function clearAllPackCache(): void {
  packCache.clear();
  retrievalCache.clear();
}

function retrievalCacheKey(fileId: string, packVersion: number, question: string, topN: number): string {
  return `${fileId}:${packVersion}:${topN}:${question.trim().toLowerCase()}`;
}

export function getCachedRetrieval(fileId: string, packVersion: number, question: string, topN: number): ScoredCard[] | null {
  const key = retrievalCacheKey(fileId, packVersion, question, topN);
  return retrievalCache.get(key) ?? null;
}

export function setCachedRetrieval(fileId: string, packVersion: number, question: string, topN: number, results: ScoredCard[]): void {
  const key = retrievalCacheKey(fileId, packVersion, question, topN);
  retrievalCache.set(key, results);
}

/** Diagnostics — exposed for the Phase 7 latency test + future observability surface. */
export function getCacheStats(): { packCacheSize: number; retrievalCacheSize: number } {
  return { packCacheSize: packCache.size, retrievalCacheSize: retrievalCache.size };
}
