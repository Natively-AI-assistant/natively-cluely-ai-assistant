// electron/rag/bundledLocalEmbedding.ts
//
// The ONE definition of the embedding model Natively bundles and runs on-device.
//
// Every place that needs to know "which local model is the bundled one" reads
// it from here: LocalEmbeddingProvider (what to load, how to call it), the
// worker (its defaults), embeddingConfigIdentity (whether a saved `local`
// selection means the bundled model or an Ollama one), the embedding catalogue
// (what Settings names) and LocalFallbackAssets (what the preflight checks).
// Before this file each of those carried its own 'Xenova/all-MiniLM-L6-v2'
// literal, which is how a model swap silently leaves one of them behind.
//
// ── CURRENT: multilingual-e5-small (since 2026-09-22) ────────────────────────
//
// History: MiniLM → multilingual-e5-base (2026-09-21, never released) →
// multilingual-e5-small (2026-09-22), each chosen by the project owner from
// measured data (docs/local-embedding-benchmark.md §9e, §12b).
//
// Measured INSIDE a real Natively session (503 questions, full corpus, the real
// retrieval stack), paired against multilingual-e5-base:
//
//   hit@1 −0.008  hit@3 −0.010  answer-anywhere −0.004   (all within noise)
//   MRR   −0.009  [−0.017, −0.001]                        (statistically worse)
//
// accepted for:
//
//   installed      129.1 MiB   vs 282.0 MiB  (base)   22.6 MiB (MiniLM)
//   peak RSS       198 MB      vs 397 MB     (base)   120 MB   (MiniLM)
//   index 900      51 s        vs 167 s      (base)   22 s     (MiniLM)
//   query p50/p95  40/43 ms    vs 67/102 ms  (base)
//
// Against MiniLM it is +0.024 hit@1 and +0.012 hit@3 (both within noise in the
// live stack) and doubles long-document recall. Multilingual support is kept,
// though NOT evidence-backed as a multilingual improvement: the multilingual
// track is 15 questions.
//
// Recipe from the model card (intfloat/multilingual-e5-small): mean pooling,
// L2-normalised, "query: " / "passage: " prefixes that apply "even for
// non-English texts". Tokenizer model_max_length is 512 (checked: it truncates;
// cf. gte-large's 1e30).

export type LocalEmbeddingPooling = 'mean' | 'cls';

export interface LocalEmbeddingRecipe {
  /** `<org>/<name>` directory under the models root (config + tokenizer + onnx/). */
  modelId: string;
  /** transformers.js dtype. 'q8' selects onnx/model_quantized.onnx. */
  dtype: 'q8' | 'fp32' | 'fp16';
  /** Output width. Asserted against the real tensor, never trusted blindly. */
  dimensions: number;
  pooling: LocalEmbeddingPooling;
  /** Prepended to query text only. Empty string means the model is symmetric. */
  queryPrefix: string;
  /** Prepended to document/chunk text only. */
  documentPrefix: string;
  /** config.max_position_embeddings. */
  maxSeqLength: number;
  /**
   * Free memory, in GB, this model needs ABOVE the shared ONNX floor before it
   * is allowed to load.
   *
   * `hasEnoughMemoryForOnnxSession()` is a fixed floor (NATIVELY_ONNX_MIN_FREE_GB,
   * default 2.0) that knows nothing about model size, so on its own it admits a
   * 492 MB model under exactly the conditions it admits a 134 MB one. This field
   * is what makes the gate model-aware. See §13 step 4 of the benchmark doc.
   */
  extraMemoryHeadroomGB: number;
}

export const BUNDLED_LOCAL_EMBEDDING: Readonly<LocalEmbeddingRecipe & {
  label: string;
  repo: string;
  revision: string;
  license: string;
}> = Object.freeze({
  modelId: 'Xenova/multilingual-e5-small',
  label: 'Multilingual E5 Small',
  repo: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  license: 'MIT',
  dtype: 'q8',
  dimensions: 384,
  pooling: 'mean',
  queryPrefix: 'query: ',
  documentPrefix: 'passage: ',
  maxSeqLength: 512,
  // Measured peak RSS 198 MB against MiniLM's 120 MB: +78 MB. Rounded up to
  // 0.2 GB for the 17 MB tokenizer and activation memory on full-length
  // (512-token) chunks, which the sanity probe texts did not exercise.
  extraMemoryHeadroomGB: 0.2,
});

/**
 * Model ids a user may have SAVED as their `local` selection that still mean
 * "the bundled model". Settings persists the model id, so an install that picked
 * the previous bundled model has 'Xenova/all-MiniLM-L6-v2' on disk. Without this
 * list, embeddingConfigIdentity treated any non-current local id as an
 * Ollama-served model and routed that user to Ollama asking for a model it does
 * not serve — a silent break on the first launch after the swap.
 */
export const LEGACY_BUNDLED_LOCAL_MODEL_IDS: readonly string[] = Object.freeze([
  'Xenova/all-MiniLM-L6-v2',
  // Bundled on the development branch for one day (2026-09-21/22) and never
  // released; listed so a dev/test profile that saved it is not routed to Ollama.
  'Xenova/multilingual-e5-base',
]);

/** True for the current bundled model id or any previously bundled one. */
export function isBundledLocalModelId(modelId?: string | null): boolean {
  if (!modelId) return false;
  const id = modelId.trim().toLowerCase();
  return id === BUNDLED_LOCAL_EMBEDDING.modelId.toLowerCase()
    || LEGACY_BUNDLED_LOCAL_MODEL_IDS.some((legacy) => legacy.toLowerCase() === id);
}

/** The four files the bundled model cannot load without, relative to the models root. */
export function bundledLocalEmbeddingFiles(): string[] {
  const base = BUNDLED_LOCAL_EMBEDDING.modelId;
  return [
    `${base}/config.json`,
    `${base}/tokenizer.json`,
    `${base}/tokenizer_config.json`,
    `${base}/onnx/model_quantized.onnx`,
  ];
}
