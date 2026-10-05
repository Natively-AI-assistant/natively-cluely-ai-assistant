// embeddingVectorHealth.ts
// A vector that points nowhere cannot be searched: all zeros has no direction,
// and one NaN or infinity makes every comparison with it NaN. sqlite-vec
// accepts both without complaint and returns a NULL distance for them, and the
// search code used to compute `1 - null` — which is 1, a perfect match that
// passed every threshold (2026-10-05). The JS path dropped the same row, so
// the two paths disagreed.
//
// The searches now skip a row with no distance. This file is the other half:
// such a vector is never stored in the first place, and never used as a query.

/** Why a vector cannot be used, or null when it can. */
export function describeUnusableVector(vector: ArrayLike<number> | null | undefined): string | null {
    if (!vector || typeof (vector as ArrayLike<number>).length !== 'number' || vector.length === 0) return 'it is empty';
    let anyNonZero = false;
    for (let i = 0; i < vector.length; i++) {
        const x = vector[i];
        if (typeof x !== 'number' || !Number.isFinite(x)) return `value ${i} is not a finite number`;
        if (x !== 0) anyNonZero = true;
    }
    return anyNonZero ? null : 'every value is zero';
}

/** The same question for a vector as it is stored: little-endian float32. */
export function describeUnusableVectorBlob(blob: Buffer | Uint8Array | null | undefined): string | null {
    if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return 'it is empty or not a whole number of floats';
    // A BLOB from SQLite is not guaranteed to start on a 4-byte boundary.
    const aligned = blob.byteOffset % 4 === 0 ? blob : new Uint8Array(blob);
    return describeUnusableVector(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/**
 * Thrown instead of storing an unusable vector. `unusableEmbedding` lets the
 * queue tell this apart from a provider that is down: the same text will get
 * the same vector again, so retrying it — or moving the whole meeting to the
 * fallback provider over it — helps nobody.
 */
export class UnusableEmbeddingError extends Error {
    readonly unusableEmbedding = true;
    constructor(what: string, reason: string) {
        super(`The embedding for ${what} cannot be searched (${reason}); not stored`);
        this.name = 'UnusableEmbeddingError';
    }
}
