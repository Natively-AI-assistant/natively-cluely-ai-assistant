// Pure, deterministic download-progress aggregator for the Whisper worker.
//
// Extracted from whisperWorker.ts so the math can be unit-tested without a
// live @huggingface/transformers import or a worker thread. The worker owns
// the side effects (postMessage); this module owns the arithmetic.
//
// THE BUG THIS REPLACES: the original worker AVERAGED each file's percentage
// weighted by *file count*, not *byte size*. A Whisper model is ~5 tiny JSON
// files (config, tokenizer, preprocessor… a few KB each) plus 1–2 huge .onnx
// weight files (hundreds of MB). The small files complete almost instantly and
// each jumped to 100%, so a count-average reported
//   (5×100 + 2×0) / 7 ≈ 71–80%
// the moment the metadata landed — then sat there for the entire real download
// while the .onnx files crawled 0→100. That is exactly the "jumps to ~80% then
// stalls" symptom.
//
// THE FIX: aggregate by BYTES. HF 'progress' events carry loaded/total byte
// counts. We track per-file {loaded, total} and report
//   sum(loaded) / max(expectedBytes, sum(total)) * 100
// so the bar reflects real wall-clock download progress dominated by the big
// weight files. `expectedBytes` (the catalog size) is the denominator from byte
// zero so the bar is smooth from 0% instead of starting against a tiny
// observed-so-far total. We take max(estimate, observed) so an under-estimate
// self-corrects upward and the bar never reports >100%.

export interface FileByteState {
    loaded: number;
    total: number;
}

// A normalized view of a single @huggingface/transformers progress_callback
// event. `file`/`name` → key; `status` drives the branch; loaded/total/progress
// carry the byte/percentage payload (any may be absent or non-numeric).
export interface ProgressEvent {
    file?: string;
    name?: string;
    status?: string;
    loaded?: unknown;
    total?: unknown;
    progress?: unknown;
}

export interface AggregatorResult {
    // The percentage to POST (0..99), already monotonic and de-duplicated, or
    // null when nothing should be posted for this event (no change, no usable
    // data yet, or a non-aggregating status like 'initiate').
    pct: number | null;
}

/**
 * Stateful per-download aggregator. One instance per worker download; its
 * fields are plain closures over a single invocation, so there is no
 * cross-download contamination (each download spawns its own Worker).
 */
export class WhisperProgressAggregator {
    private readonly fileBytes = new Map<string, FileByteState>();
    private lastPostedPct = 0;
    private readonly expectedBytes: number;

    /**
     * @param expectedBytes Catalog download size in bytes (the denominator from
     *   byte zero). Any non-finite / negative / zero value is treated as 0,
     *   which transparently falls back to the observed file totals.
     */
    constructor(expectedBytes: number) {
        const n = Number(expectedBytes);
        this.expectedBytes = Number.isFinite(n) && n > 0 ? n : 0;
    }

    /**
     * Feed one progress event. Returns the percentage to post, or null if this
     * event produces no new value worth sending.
     */
    update(data: ProgressEvent): AggregatorResult {
        const key = data.file ?? data.name;
        if (!key) return { pct: null };

        if (data.status === 'progress') {
            const total = Number(data.total);
            const loaded = Number(data.loaded);
            if (Number.isFinite(total) && total > 0 && Number.isFinite(loaded)) {
                const clampedLoaded = Math.min(total, Math.max(0, loaded));
                const prev = this.fileBytes.get(key);
                // Per-file monotonic on loaded bytes; keep the largest known total.
                this.fileBytes.set(key, {
                    loaded: prev ? Math.max(prev.loaded, clampedLoaded) : clampedLoaded,
                    total: prev ? Math.max(prev.total, total) : total,
                });
            } else {
                // Streamed file without byte counts — fall back to its percentage
                // applied to whatever total we last saw (or skip if unknown).
                const p = Number(data.progress);
                const prev = this.fileBytes.get(key);
                if (prev && prev.total > 0 && Number.isFinite(p)) {
                    const byPct = Math.min(prev.total, Math.max(0, (p / 100) * prev.total));
                    this.fileBytes.set(key, { loaded: Math.max(prev.loaded, byPct), total: prev.total });
                }
            }
        } else if (data.status === 'done') {
            // Mark this file fully downloaded. If we already know its size, snap
            // loaded→total; otherwise leave it absent so it never affects the
            // byte ratio (tiny metadata files have negligible weight anyway).
            const prev = this.fileBytes.get(key);
            if (prev && prev.total > 0) {
                this.fileBytes.set(key, { loaded: prev.total, total: prev.total });
            }
        } else {
            // 'initiate' / 'download' / unknown: nothing to aggregate yet. Do
            // NOT seed a 0/0 entry — an entry with total 0 would either divide
            // by zero or, worse, count toward a file-count average (the old bug).
            return { pct: null };
        }

        let loadedSum = 0;
        let observedTotal = 0;
        for (const v of this.fileBytes.values()) {
            if (v.total > 0) {
                loadedSum += v.loaded;
                observedTotal += v.total;
            }
        }
        // Denominator: prefer the catalog estimate so the bar is smooth from 0%,
        // but never let it be smaller than what we've actually observed (guards
        // against an under-estimate reporting >100%). Falls back to the observed
        // total when expectedBytes is 0 (unknown id / lookup failed).
        const totalSum = Math.max(this.expectedBytes, observedTotal);
        if (totalSum <= 0) return { pct: null };

        const pct = (loadedSum / totalSum) * 100;
        // Cap at 99 — only the 'ready' completion event sets 100. Floor so we
        // don't post 0.7 → 1 → 1 → 1.4 → 2 churn.
        const rounded = Math.min(99, Math.floor(pct));
        // Cross-file safety net: don't decrease (e.g. when a brand-new file
        // joins the map its total enlarges the denominator and could nudge the
        // ratio backwards by a hair).
        const next = Math.max(this.lastPostedPct, rounded);
        if (next === this.lastPostedPct) return { pct: null };
        this.lastPostedPct = next;
        return { pct: next };
    }
}
