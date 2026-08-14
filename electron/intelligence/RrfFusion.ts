// electron/intelligence/RrfFusion.ts
//
// Phase 2 (smart-retrieval rollout) — Reciprocal Rank Fusion (RRF).
//
// Merges the RANKED outputs of heterogeneous retrieval sources — modes RAG
// (combined cosine/FTS score), Profile Tree (structured matches), and Hindsight
// (long-term recall, which on 0.8.2 returns NO score at all) — into ONE ranked
// list, then reports a unified confidence over that merged list.
//
// Why RRF and not score normalization: the three sources produce scores on
// incomparable scales (or none). RRF (Cormack, Clarke & Büttcher, SIGIR 2009)
// ranks purely by POSITION:  score(item) = Σ_sources  weight_s / (k + rank_s).
// k≈60 damps the contribution of deep ranks. An item that appears in several
// sources' lists accumulates contributions — so "RAG ranked it #4 AND Hindsight
// ranked it #1" beats "only RAG ranked it #1", which is exactly the cross-source
// corroboration we want. A miss in one source is simply an absent term, not a
// zero that drags the fused score down.
//
// This module is PURE and deterministic: no IO, no model calls, no clock. It is
// ADDITIVE — nothing consumes it until a caller is wired (Phase 2 ships the
// mechanism + tests behind the `ragRrfFusion` flag, default OFF). Never throws.

/** Standard RRF damping constant from the original paper. */
export const DEFAULT_RRF_K = 60;

/** A single ranked source's contribution to the fusion. */
export interface RankedSource {
    /** Stable source label (e.g. 'rag', 'profile_tree', 'hindsight'). */
    source: string;
    /**
     * Items in RANK ORDER (best first). Only the ORDER matters — any per-item
     * score is ignored by RRF on purpose (sources' scores are incomparable).
     */
    items: RankedItem[];
    /**
     * Optional per-source weight (default 1). Lets a caller trust one source
     * more without re-scaling its (incomparable) raw scores — e.g. weight the
     * Profile Tree above Hindsight for identity-shaped queries.
     */
    weight?: number;
}

export interface RankedItem {
    /** The retrieved text/snippet. */
    text: string;
    /**
     * Stable identity used to MERGE the same item across sources. When omitted,
     * a normalized hash of `text` is used, so two sources returning the same
     * passage fuse into one fused entry (their contributions sum). Provide an
     * explicit id (e.g. `${fileId}:${chunkIndex}`) when available — it's more
     * robust than text-identity to whitespace/casing drift.
     */
    id?: string;
    /** Optional provenance carried through to the fused result (unused by RRF). */
    meta?: Record<string, unknown>;
}

export interface FusedItem {
    id: string;
    text: string;
    /** Summed RRF score across all sources that ranked this item. */
    rrfScore: number;
    /** Which sources contributed, with the rank each gave this item (0-based). */
    contributions: Array<{ source: string; rank: number; weight: number }>;
    /** Carried from the first source that supplied it (provenance/debug). */
    meta?: Record<string, unknown>;
}

/**
 * Unified confidence over the FUSED list — the Phase-2 analogue of the modes
 * retriever's per-source confidence, but computed across all sources so a
 * single source's miss doesn't read as a global miss.
 */
export interface FusedConfidence {
    /** Top fused RRF score. */
    topScore: number;
    /** Gap between the top two fused items (0 when <2 items). */
    margin: number;
    /** Number of fused items. */
    fusedCount: number;
    /** Number of distinct sources that contributed at least one item. */
    contributingSources: number;
    /** Number of fused items corroborated by >1 source. */
    corroboratedCount: number;
    lowConfidence: boolean;
    reasons: Array<'no_items' | 'single_source_only' | 'weak_top' | 'flat_margin'>;
}

export interface RrfFusionResult {
    fused: FusedItem[];
    confidence: FusedConfidence;
}

export interface RrfOptions {
    /** RRF damping constant (default 60). */
    k?: number;
    /** Cap the fused output length (default: all). */
    topN?: number;
}

// ── Confidence thresholds (fused space) ─────────────────────────────────────
// These are intentionally separate from the modes retriever's per-source gate
// constants — RRF scores live on a different (1/(k+rank)) scale. With k=60, a
// rank-0 item contributes ~0.0164 per source; two sources agreeing at rank 0
// gives ~0.0328. The floors below are calibrated to that scale.
const FUSED_WEAK_TOP = 1 / (DEFAULT_RRF_K + 2);   // top no better than a ~rank-2 single-source hit
const FUSED_MARGIN_MIN = 0.004;                   // top-2 effectively tied

/** Normalize text for identity-hashing when no explicit id is given. */
function textKey(text: string): string {
    const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
    // Cheap, stable polynomial hash (same family as ModeHybridRetriever.hashContent)
    // so identical passages from different sources collapse to one fused entry.
    let h = 0;
    const s = norm.slice(0, 4000);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    h = ((h << 5) - h + norm.length) | 0;
    return 't_' + (h >>> 0).toString(16);
}

/**
 * Fuse N ranked sources into one ranked list via Reciprocal Rank Fusion.
 * Pure + deterministic; never throws (bad input → empty result).
 */
export function fuseRanked(sources: RankedSource[], options: RrfOptions = {}): RrfFusionResult {
    const k = options.k ?? DEFAULT_RRF_K;
    const byId = new Map<string, FusedItem>();
    const sourcesSeen = new Set<string>();

    try {
        for (const src of sources || []) {
            if (!src || !Array.isArray(src.items) || src.items.length === 0) continue;
            const weight = typeof src.weight === 'number' && src.weight > 0 ? src.weight : 1;
            let contributedAny = false;

            for (let rank = 0; rank < src.items.length; rank++) {
                const item = src.items[rank];
                if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
                const id = (item.id && item.id.trim()) ? item.id.trim() : textKey(item.text);
                const contribution = weight / (k + rank + 1); // rank+1 → 1-based per the paper

                const existing = byId.get(id);
                if (existing) {
                    existing.rrfScore += contribution;
                    existing.contributions.push({ source: src.source, rank, weight });
                } else {
                    byId.set(id, {
                        id,
                        text: item.text,
                        rrfScore: contribution,
                        contributions: [{ source: src.source, rank, weight }],
                        ...(item.meta ? { meta: item.meta } : {}),
                    });
                }
                contributedAny = true;
            }
            if (contributedAny) sourcesSeen.add(src.source);
        }
    } catch {
        // Pure function — on any unexpected input shape, fall through to empty.
    }

    let fused = Array.from(byId.values()).sort((a, b) => {
        if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
        // Deterministic tie-break: more corroborating sources first, then id.
        if (b.contributions.length !== a.contributions.length) {
            return b.contributions.length - a.contributions.length;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    if (typeof options.topN === 'number' && options.topN >= 0) {
        fused = fused.slice(0, options.topN);
    }

    return { fused, confidence: computeFusedConfidence(fused, sourcesSeen.size) };
}

function computeFusedConfidence(fused: FusedItem[], contributingSources: number): FusedConfidence {
    const topScore = fused.length > 0 ? fused[0].rrfScore : 0;
    const secondScore = fused.length > 1 ? fused[1].rrfScore : 0;
    const margin = topScore - secondScore;
    const corroboratedCount = fused.filter(f => f.contributions.length > 1).length;
    const reasons: FusedConfidence['reasons'] = [];

    if (fused.length === 0) {
        reasons.push('no_items');
    } else {
        // Only one source contributed anything → no cross-source corroboration
        // possible; treat as lower confidence (the whole point of fusing).
        if (contributingSources <= 1) reasons.push('single_source_only');
        if (topScore < FUSED_WEAK_TOP) reasons.push('weak_top');
        if (fused.length > 1 && margin < FUSED_MARGIN_MIN) reasons.push('flat_margin');
    }

    return {
        topScore,
        margin,
        fusedCount: fused.length,
        contributingSources,
        corroboratedCount,
        lowConfidence: reasons.length > 0,
        reasons,
    };
}
