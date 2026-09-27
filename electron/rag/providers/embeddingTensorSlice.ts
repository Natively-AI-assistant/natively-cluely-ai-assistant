// electron/rag/providers/embeddingTensorSlice.ts
//
// Split a feature-extraction output tensor into one vector per input text.
//
// ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
//
// This is four lines of arithmetic that, when wrong, produce SILENT CORRUPTION
// rather than an error — so it is worth isolating where a test can reach it
// without standing up ONNX Runtime and a 110MB model.
//
// localEmbeddingWorker.ts used to slice at a hardcoded `DIMENSIONS = 384`,
// which is correct for the bundled MiniLM and catastrophic for anything wider.
// Against a 768-dim model, batch item i receives the bytes belonging to item
// i/2: finite, unit-norm, correctly shaped, and wrong. Nothing throws; the only
// symptom is degraded retrieval, which reads as a model quality result.
//
// Measured against real Snowflake/snowflake-arctic-embed-m tensors
// (scripts/embedding-slicing-negative-control.mjs), cosine of the old slicing
// against the correct vector, per batch item:
//
//     item 0:  1.000000      <- passes even when broken
//     item 1: -0.015464
//     item 2:  0.584062
//     item 3: -0.045578
//
// Item 0 scores a perfect 1.000 because its first 384 floats genuinely ARE its
// own. Any check that inspects only the first vector of a batch cannot see this
// defect, which is why the regression test sweeps every item.
//
// The width therefore comes from the TENSOR, never from a constant, and the
// batch x width invariant is asserted rather than assumed.

/** The shape-carrying subset of a transformers.js `Tensor` we actually need. */
export interface EmbeddingTensorLike {
  /** Flat backing store, length must equal batch x width. */
  data: ArrayLike<number>;
  /** `[batch, width]` after pooling. The LAST axis is the embedding width. */
  dims?: number[];
}

/**
 * Derive the embedding width from a pooled tensor.
 *
 * `dims` is `[batch, width]` after mean/CLS pooling, so the width is the last
 * axis. `fallbackWidth` covers a tensor that reports no dims at all; callers
 * pass the model's declared width so behaviour is unchanged for the bundled
 * model, whose tensors do carry dims.
 */
export function deriveEmbeddingWidth(tensor: EmbeddingTensorLike, fallbackWidth: number): number {
  const dims = Array.isArray(tensor.dims) ? tensor.dims : [];
  return dims.length > 0 ? dims[dims.length - 1] : fallbackWidth;
}

/**
 * Split `tensor` into `batchSize` vectors of the tensor's own width.
 *
 * Throws when the tensor is not exactly `batchSize x width`, because past that
 * point the slicing cannot be trusted and emitting the vectors anyway would
 * write mislabelled rows into the index. Failing loudly is the whole point:
 * the defect this guards against was invisible precisely because it did not.
 *
 * @param modelLabel only used to make the error message identify the culprit.
 */
export function sliceEmbeddingTensor(
  tensor: EmbeddingTensorLike,
  batchSize: number,
  fallbackWidth: number,
  modelLabel = 'unknown model',
): number[][] {
  const width = deriveEmbeddingWidth(tensor, fallbackWidth);
  const total = tensor.data.length;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`[embeddingTensorSlice] invalid batchSize ${batchSize} for ${modelLabel}`);
  }
  if (!Number.isInteger(width) || width <= 0 || total !== batchSize * width) {
    throw new Error(
      `[embeddingTensorSlice] unexpected tensor shape for ${modelLabel}: ` +
      `dims=[${(tensor.dims || []).join(',')}] data.length=${total} ` +
      `batch=${batchSize} derived width=${width}`,
    );
  }

  const vectors: number[][] = [];
  for (let i = 0; i < batchSize; i++) {
    vectors.push(Array.from((tensor.data as any).slice(i * width, (i + 1) * width)) as number[]);
  }
  return vectors;
}
