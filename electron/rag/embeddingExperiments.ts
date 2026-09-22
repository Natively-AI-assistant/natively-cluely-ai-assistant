// electron/rag/embeddingExperiments.ts
//
// R&D ONLY. The candidate set for the local-embedding bake-off.
//
// This file exists so a benchmark run can point Natively's REAL local embedding
// path at a different bundled-style ONNX model without touching the production
// default. It is inert unless `NATIVELY_EMBEDDING_EXPERIMENT` names a key below:
// `resolveEmbeddingExperiment()` returns null and LocalEmbeddingProvider keeps
// its historical MiniLM behaviour byte-for-byte.
//
// NOTHING here changes what a shipped build does. There is no Settings surface,
// no catalogue entry, no migration. Deleting this file plus the two `experiment`
// branches in LocalEmbeddingProvider/localEmbeddingWorker restores the exact
// pre-experiment code.
//
// ---------------------------------------------------------------------------
// Why each field exists
// ---------------------------------------------------------------------------
// `pooling` and `queryPrefix`/`documentPrefix` are NOT cosmetic. The candidates
// disagree on both, and getting either wrong produces a bad retrieval number
// that looks like a model quality result:
//
//   arctic-*, bge-*     CLS pooling,  query prefix only, document bare
//   e5-*                mean pooling, "query: " / "passage: "
//   nomic-v1.5          mean pooling, "search_query: " / "search_document: "
//   gte-small, MiniLM   mean pooling, no prefixes (symmetric)
//
// Every value below is copied from the model's own card (fetched 2026-09-21),
// not from memory. See docs/local-embedding-benchmark.md for the citations.
//
// `space` isolation comes free: LocalEmbeddingProvider feeds `spaceModelId`
// into the existing embeddingSpaceKey({name, model, dimensions}), so an
// experiment's vectors land under e.g.
//   local:snowflake/snowflake-arctic-embed-s@q8@cls@v1:384
// which can never compare equal to production's
//   local:xenova/all-minilm-l6-v2:384
// RAGManager already filters retrieval by getActiveSpaceKey(), so the two sets
// cannot mix even inside one database file.

// 'last' = last-token pooling (Qwen3-Embedding); the worker maps it to
// transformers.js 'last_token'. Correct only with a left-padding tokenizer.
export type EmbeddingPooling = 'mean' | 'cls' | 'last';

export interface EmbeddingExperiment {
  /** Key used by NATIVELY_EMBEDDING_EXPERIMENT and in results files. */
  key: string;
  /** Hugging Face repo the artifact is downloaded from. */
  repo: string;
  /** Exact commit the artifact was pinned to. Never a moving `main`. */
  revision: string;
  /** SPDX license of the upstream weights, read from the source repo. */
  license: string;
  /**
   * Model id as transformers.js resolves it under `env.localModelPath`, i.e.
   * the `<org>/<name>` directory holding config.json + tokenizer.json + onnx/.
   */
  modelId: string;
  /** transformers.js dtype → selects onnx/model_quantized.onnx for 'q8'. */
  dtype: 'q8' | 'fp32' | 'fp16';
  /** Expected output width. Asserted against the real tensor, never trusted. */
  dimensions: number;
  pooling: EmbeddingPooling;
  /** Prepended to query text only. Empty string means the model is symmetric. */
  queryPrefix: string;
  /** Prepended to document/chunk text only. */
  documentPrefix: string;
  /** Model's own max sequence length, from config.max_position_embeddings. */
  maxSeqLength: number;
  /** Distinguishes vectors in the space key. Bump if a recipe field changes. */
  recipeVersion: string;
  note: string;
  /** Truncate inputs to this many tokens (long-context models; see the catalog field). */
  maxInputTokens?: number;
  /** Largest embed batch per worker call. */
  maxBatchSize?: number;
}

/**
 * The incumbent, expressed as an experiment so the baseline is measured through
 * the exact same code path as every candidate rather than against the old
 * Python harness's sentence-transformers fp32 cache (which is a different
 * model than the one Natively actually runs).
 */
export const MINILM_BASELINE: EmbeddingExperiment = {
  key: 'minilm-baseline',
  repo: 'Xenova/all-MiniLM-L6-v2',
  // Byte-identical to the copy bundled until 2026-09-21; no longer shipped, so
  // scripts/download-embedding-experiments.mjs fetches it like any candidate.
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  license: 'apache-2.0',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  dtype: 'q8',
  dimensions: 384,
  pooling: 'mean',
  queryPrefix: '',
  documentPrefix: '',
  maxSeqLength: 512,
  recipeVersion: 'v1',
  note: 'Bundled default until 2026-09-21 (no longer shipped). Symmetric: embedQuery === embed.',
};

export const EMBEDDING_EXPERIMENTS: Readonly<Record<string, EmbeddingExperiment>> = Object.freeze({
  'minilm-baseline': MINILM_BASELINE,

  'arctic-xs': {
    key: 'arctic-xs',
    repo: 'Snowflake/snowflake-arctic-embed-xs',
    revision: 'd8c86521100d3556476a063fc2342036d45c106f',
    license: 'apache-2.0',
    modelId: 'Snowflake/snowflake-arctic-embed-xs',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: '22M params. Card: "use the CLS token to embed each text portion and use the query prefix (just on the query)".',
  },

  'arctic-s': {
    key: 'arctic-s',
    repo: 'Snowflake/snowflake-arctic-embed-s',
    revision: 'e596f507467533e48a2e17c007f0e1dacc837b33',
    license: 'apache-2.0',
    modelId: 'Snowflake/snowflake-arctic-embed-s',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: '33M params. Same recipe as arctic-xs.',
  },

  'arctic-m': {
    key: 'arctic-m',
    repo: 'Snowflake/snowflake-arctic-embed-m',
    revision: 'fc74610d18462d218e312aa986ec5c8a75a98152',
    license: 'apache-2.0',
    modelId: 'Snowflake/snowflake-arctic-embed-m',
    dtype: 'q8',
    dimensions: 768,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: '110M params, 768d. The first candidate whose width differs from MiniLM.',
  },

  'bge-small-en': {
    key: 'bge-small-en',
    repo: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    license: 'mit',
    modelId: 'Xenova/bge-small-en-v1.5',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Upstream BAAI/bge-small-en-v1.5 (MIT). Xenova mirror used because BAAI ships only fp32 model.onnx.',
  },

  'e5-small-v2': {
    key: 'e5-small-v2',
    repo: 'Xenova/e5-small-v2',
    revision: '02af79985278377e65c724a76275707cb0333c70',
    license: 'mit',
    modelId: 'Xenova/e5-small-v2',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Card: "Each input text should start with query: or passage:".',
  },

  'gte-small': {
    key: 'gte-small',
    repo: 'Xenova/gte-small',
    revision: '5927d1727bb12db490052a1b33265ad78058de08',
    license: 'mit',
    modelId: 'Xenova/gte-small',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'No instruction/prefix in the card. Symmetric, mean pooling, normalized.',
  },

  'nomic-v1.5': {
    key: 'nomic-v1.5',
    repo: 'nomic-ai/nomic-embed-text-v1.5',
    revision: 'e9b6763023c676ca8431644204f50c2b100d9aab',
    license: 'apache-2.0',
    modelId: 'nomic-ai/nomic-embed-text-v1.5',
    dtype: 'q8',
    dimensions: 768,
    pooling: 'mean',
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
    maxSeqLength: 2048,
    recipeVersion: 'v1',
    note: 'Card: "the text prompt MUST include a task instruction prefix". 2048-token context, the only candidate above 512.',
  },

  // ── Round 2: the largest member of each family that fits the 500 MiB cap ──
  //
  // Round 1 took the SMALL variant of every family. These are the widest
  // variants the cap allows, which is also the first real exercise of the
  // tensor-width fix at 1024 dimensions (§5) — round 1 only reached 768.
  //
  // Recipes are unchanged within a family: each card gives the same pooling and
  // prefixes as its small sibling (re-read 2026-09-21, not assumed).
  //
  // EXCLUDED, recorded rather than silently dropped:
  //   Xenova/multilingual-e5-large — 1024d, installed 552.0 MiB > 500 MiB cap.
  //   SIZE FAILURE. Its family therefore caps at the 768d base below.

  'arctic-l': {
    key: 'arctic-l',
    repo: 'Snowflake/snowflake-arctic-embed-l',
    revision: 'd8fb21ca8d905d2832ee8b96c894d3298964346b',
    license: 'apache-2.0',
    modelId: 'Snowflake/snowflake-arctic-embed-l',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: '335M params, 1024d. Widest Arctic under the cap (322.1 MiB).',
  },

  'bge-large-en': {
    key: 'bge-large-en',
    repo: 'Xenova/bge-large-en-v1.5',
    revision: 'dfeef6070b90658e1b391a6940efdb0925c1de6f',
    license: 'mit',
    modelId: 'Xenova/bge-large-en-v1.5',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Upstream BAAI/bge-large-en-v1.5 (MIT). Same CLS + query-instruction recipe as bge-small.',
  },

  'e5-large-v2': {
    key: 'e5-large-v2',
    repo: 'Xenova/e5-large-v2',
    revision: '840fd2207f68e253697ed85392a482ff7657ad11',
    license: 'mit',
    modelId: 'Xenova/e5-large-v2',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Upstream intfloat/e5-large-v2 (MIT). Same query:/passage: recipe as e5-small-v2.',
  },

  'gte-large': {
    key: 'gte-large',
    repo: 'Xenova/gte-large',
    revision: '06a8d51d496ebe830042b7323a904b4da81ac500',
    license: 'mit',
    modelId: 'Xenova/gte-large',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Upstream thenlper/gte-large (MIT). Symmetric, no instruction, like gte-small.',
  },

  'multilingual-e5-base': {
    key: 'multilingual-e5-base',
    repo: 'Xenova/multilingual-e5-base',
    revision: '1ec9243030a27d1a115d5c340572074c125b58b2',
    license: 'mit',
    modelId: 'Xenova/multilingual-e5-base',
    dtype: 'q8',
    dimensions: 768,
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxSeqLength: 514,
    recipeVersion: 'v1',
    note: 'Widest multilingual-E5 under the cap (282.0 MiB); the 1024d large is 552.0 MiB and EXCLUDED.',
  },

  'multilingual-e5-small': {
    key: 'multilingual-e5-small',
    repo: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    license: 'mit',
    modelId: 'Xenova/multilingual-e5-small',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'Upstream intfloat/multilingual-e5-small (MIT). Card: prefixes apply "even for non-English texts".',
  },

  // Round 3 (2026-09-22): three larger models proposed for high-end machines.
  // Recipes from each repo's own sentence-transformers config (pooling config
  // and `prompts`), not guessed.
  'qwen3-embedding-0.6b': {
    key: 'qwen3-embedding-0.6b',
    repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    revision: 'c25a394dd583836952667c12f008335071b3f43d',
    license: 'apache-2.0',
    modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'last',
    // Upstream Qwen/Qwen3-Embedding-0.6B prompts.query, verbatim (no space after "Query:").
    queryPrefix: 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:',
    documentPrefix: '',
    maxSeqLength: 32768,
    maxInputTokens: 512,
    recipeVersion: 'v1',
    note: 'Decoder-based (Qwen3), last-token pooling, left padding. Multilingual.',
  },

  'arctic-l-v2': {
    key: 'arctic-l-v2',
    repo: 'Snowflake/snowflake-arctic-embed-l-v2.0',
    revision: 'ac6544c8a46e00af67e330e85a9028c66b8cfd9a',
    license: 'apache-2.0',
    modelId: 'Snowflake/snowflake-arctic-embed-l-v2.0',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'cls',
    queryPrefix: 'query: ',
    documentPrefix: '',
    maxSeqLength: 8192,
    maxInputTokens: 512,
    recipeVersion: 'v1',
    note: 'Arctic v2.0 (XLM-R base, multilingual). A different model from round 2\'s English arctic-l.',
  },

  'mxbai-large-v1': {
    key: 'mxbai-large-v1',
    repo: 'mixedbread-ai/mxbai-embed-large-v1',
    revision: 'b33106f585b9ce46904ad7443a3b52b7a63e231c',
    license: 'apache-2.0',
    modelId: 'mixedbread-ai/mxbai-embed-large-v1',
    dtype: 'q8',
    dimensions: 1024,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    maxSeqLength: 512,
    recipeVersion: 'v1',
    note: 'BERT-large class, CLS pooling, query instruction. English.',
  },
});

/**
 * The model id written into the embedding space key. Carries every identity
 * field that changes the vectors, so two recipes can never share a collection
 * even at identical width.
 */
export function experimentSpaceModelId(e: EmbeddingExperiment): string {
  if (e.key === 'minilm-baseline') return e.modelId; // production key, unchanged
  return `${e.modelId}@${e.dtype}@${e.pooling}@${e.recipeVersion}`;
}

/**
 * Read the active experiment from the environment. Returns null when unset or
 * unknown — the caller then behaves exactly as it did before this file existed.
 *
 * An UNKNOWN key throws rather than silently falling back to MiniLM: a typo in
 * a benchmark script must not quietly produce a full set of baseline numbers
 * labelled as a candidate.
 */
export function resolveEmbeddingExperiment(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingExperiment | null {
  const key = (env.NATIVELY_EMBEDDING_EXPERIMENT || '').trim();
  if (!key) return null;
  const found = EMBEDDING_EXPERIMENTS[key];
  if (!found) {
    throw new Error(
      `[embeddingExperiments] unknown NATIVELY_EMBEDDING_EXPERIMENT="${key}". ` +
      `Known keys: ${Object.keys(EMBEDDING_EXPERIMENTS).join(', ')}`,
    );
  }
  return found;
}

/** Apply the model's own retrieval recipe to text about to be embedded. */
export function applyPrefix(
  e: EmbeddingExperiment,
  text: string,
  role: 'query' | 'document',
): string {
  const prefix = role === 'query' ? e.queryPrefix : e.documentPrefix;
  return prefix ? prefix + text : text;
}
