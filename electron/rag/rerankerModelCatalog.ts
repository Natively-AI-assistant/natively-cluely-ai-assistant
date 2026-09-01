/**
 * Rerankers a user can install directly, without staging an extension folder.
 *
 * WHY THIS EXISTS IN CORE AT ALL
 *
 * `docs/extensions.md` says Core contains no model-specific code, and that rule
 * still holds. What is here is a DATA table, not an adapter: a repository, a
 * file list, a licence and — for the ONNX entries — a `modelId` and a `dtype`.
 *
 * The ONNX entries need no new code because Core already runs an ONNX
 * cross-encoder: `LocalReranker` loads `Xenova/bge-reranker-base` through
 * transformers.js, and `resolveModelPath()` looks for
 * `<root>/<org>/<name>/tokenizer.json`. Pointing that runtime at a different
 * directory is configuration, not a port — PROVIDED the model is a real
 * sequence-classification cross-encoder.
 *
 * THAT PROVISO IS LOAD-BEARING, and it is why the Ettin entries below are
 * marked unsupported. Their `onnx/model.onnx` was loaded with onnxruntime and
 * its graph output is `last_hidden_state`, not `logits`: the export is the
 * transformer BACKBONE only. The scoring head lives outside the graph, in the
 * repository's Sentence-Transformers module chain (`1_Pooling`, `2_Dense`,
 * `3_LayerNorm`, `4_Dense` as safetensors). transformers.js has no equivalent
 * module pipeline, so the model loads, runs, and returns no score — which is
 * exactly what happened: `output.logits` came back `undefined` and the rerank
 * fell through to "unexpected logits shape". Downloading it would produce a
 * button that cannot work.
 *
 * Every model marked `supported: true` had its ONNX graph checked for a
 * `logits` output before it was listed.
 *
 * The GGUF entries are the opposite case, and they are treated differently on
 * purpose (see `runtime` below). Core has no llama.cpp. Downloading a GGUF into
 * a Core-owned directory would produce several hundred megabytes that nothing
 * can execute, so those route through the owning extension's `ModelStore`
 * instead — which is also what keeps the licence gate intact.
 *
 * EVERY NUMBER HERE WAS READ FROM THE HUGGING FACE API ON 2026-09-01
 *
 * Sizes, revisions and sha256 digests come from `/api/models/<repo>?blobs=true`,
 * not from a model card and not from memory. `tokenizer.json` and `config.json`
 * are not LFS objects, so Hugging Face publishes no digest for them; those
 * carry `sha256: null`, which the downloader records rather than checks. The
 * pinned revision is what protects them.
 */

export type RerankerRuntime = 'onnx' | 'gguf';

export interface CatalogFile {
  /** Path inside the repository. May be nested (`onnx/model.onnx`). */
  repoPath: string;
  bytes: number;
  /** null where Hugging Face publishes none — a non-LFS file. Never faked. */
  sha256: string | null;
}

export interface LocalRerankerModel {
  id: string;
  name: string;
  runtime: RerankerRuntime;
  repo: string;
  /** Commit pinned at catalogue time. The downloader re-resolves and prefers the live default branch. */
  revision: string;
  files: CatalogFile[];
  /** Total download, summed from the real file sizes. */
  bytes: number;
  license: {
    spdx: string;
    url: string;
    commercialUseRestricted: boolean;
    requiresAcknowledgement: boolean;
  };
  /** Short, honest descriptors for the row. */
  params: string;
  note: string;
  recommended?: boolean;
  /**
   * False when Core cannot execute this model even once it is downloaded. Such
   * an entry is shown with its reason rather than hidden, so the answer to
   * "why can't I install Ettin" is visible instead of absent.
   */
  supported: boolean;
  unsupportedReason?: string;

  // ── ONNX only ──────────────────────────────────────────────────────────
  /**
   * What `LocalReranker` should be pointed at. Equal to `repo` for these, since
   * transformers.js resolves `<root>/<org>/<name>/`.
   */
  modelId?: string;
  /**
   * transformers.js variant selector. Ettin publishes `onnx/model.onnx` (fp32)
   * and architecture-specific int8 exports (`model_qint8_arm64`,
   * `model_qint8_avx512`) — which cannot be ONE cross-platform entry, so this
   * uses the portable fp32 file. That is why 'Ettin 150M' is a 597MB download
   * despite being a 150M-parameter model; the row shows the bytes for exactly
   * this reason.
   */
  dtype?: 'fp32' | 'q8';

  // ── GGUF only ──────────────────────────────────────────────────────────
  /** The extension that can actually execute this file. */
  extensionId?: string;
  /** Named so the UI can say what is missing rather than just failing. */
  requiresBinary?: string;
}

/** Where an installed ONNX reranker lives, relative to the local-models root. */
export function onnxModelSubdir(model: LocalRerankerModel): string {
  return model.repo;
}

export const RERANKER_MODEL_CATALOG: LocalRerankerModel[] = [
  // ── ONNX cross-encoders: verified to expose a `logits` output, so they run
  //    on the reranker Core already ships. dtype q8 => onnx/model_quantized.onnx.
  {
    id: 'ms-marco-minilm-l6',
    name: 'MS MARCO MiniLM L6',
    runtime: 'onnx',
    repo: 'Xenova/ms-marco-MiniLM-L-6-v2',
    modelId: 'Xenova/ms-marco-MiniLM-L-6-v2',
    dtype: 'q8',
    revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec',
    supported: true,
    files: [
      { repoPath: 'onnx/model_quantized.onnx', bytes: 23143499, sha256: 'e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe' },
      { repoPath: 'tokenizer.json', bytes: 711396, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 1242, sha256: null },
      { repoPath: 'special_tokens_map.json', bytes: 125, sha256: null },
      { repoPath: 'config.json', bytes: 824, sha256: null },
    ],
    bytes: 23857086,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '22M · int8',
    note: 'Tiny and quick. The lightest option that actually reranks.',
  },
  {
    id: 'mxbai-rerank-xsmall',
    name: 'mxbai Rerank XSmall',
    runtime: 'onnx',
    repo: 'mixedbread-ai/mxbai-rerank-xsmall-v1',
    modelId: 'mixedbread-ai/mxbai-rerank-xsmall-v1',
    dtype: 'q8',
    revision: 'b5c6e9da73abc3711f593f705371cdbe9e0fe422',
    supported: true,
    recommended: true,
    files: [
      { repoPath: 'onnx/model_quantized.onnx', bytes: 87245802, sha256: '15ef19a6de90be7d52b627f2c784107bd806e64826450f41fb75fa4f0179ab30' },
      { repoPath: 'tokenizer.json', bytes: 8649139, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 1447, sha256: null },
      { repoPath: 'special_tokens_map.json', bytes: 970, sha256: null },
      { repoPath: 'config.json', bytes: 968, sha256: null },
    ],
    bytes: 95898326,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/mixedbread-ai/mxbai-rerank-xsmall-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '70M · int8',
    note: 'A good default: small download, noticeably better than the built-in.',
  },
  {
    id: 'bge-reranker-large',
    name: 'BGE Reranker Large',
    runtime: 'onnx',
    repo: 'Xenova/bge-reranker-large',
    modelId: 'Xenova/bge-reranker-large',
    dtype: 'q8',
    revision: '3c4ff3c9420fb24ea62acd31e3884e09c8827f2a',
    supported: true,
    files: [
      { repoPath: 'onnx/model_quantized.onnx', bytes: 562938749, sha256: '62cbff7af164e3a5c6776918a25c1b24a54a31854bdbe83ffe1dd13f68901637' },
      { repoPath: 'tokenizer.json', bytes: 17098079, sha256: '48564c5c7d3fa64d85d95e65414a542385f88b0f128fd8d4163fd7a57f2be05c' },
      { repoPath: 'tokenizer_config.json', bytes: 443, sha256: null },
      { repoPath: 'special_tokens_map.json', bytes: 279, sha256: null },
      { repoPath: 'config.json', bytes: 883, sha256: null },
    ],
    bytes: 580038433,
    license: { spdx: 'MIT', url: 'https://huggingface.co/Xenova/bge-reranker-large', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '560M · int8',
    note: 'Highest quality of the local models measured (MRR 0.715 vs the built-in 0.539) — but the slowest to load, and it did not clear the live 1200ms budget in that run.',
  },

  // ── Ettin: downloadable bytes, but Core cannot score them. See the header. ──
  {
    id: 'ettin-reranker-32m',
    name: 'Ettin Reranker 32M',
    runtime: 'onnx',
    repo: 'cross-encoder/ettin-reranker-32m-v1',
    revision: 'b33e5ceb5110773ea9cf5e00c9bedc83a8c2afdd',
    supported: false,
    unsupportedReason: 'Its ONNX export is the transformer only — the scoring head is a separate Sentence-Transformers module chain that Natively cannot run yet.',
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 127737036, sha256: '31061d9f54e8303f5d95cf3433dcf99f50d5f6de283c3b8357452be8c824142f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 1730, sha256: null },
    ],
    bytes: 131322093,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-32m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '32M',
    note: 'Not usable yet.',
  },
  {
    id: 'ettin-reranker-68m',
    name: 'Ettin Reranker 68M',
    runtime: 'onnx',
    repo: 'cross-encoder/ettin-reranker-68m-v1',
    revision: 'd166fa88ddde3c42bc3ee92f7df476d941c8204a',
    supported: false,
    unsupportedReason: 'Its ONNX export is the transformer only — the scoring head is a separate Sentence-Transformers module chain that Natively cannot run yet.',
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 272978775, sha256: '95505bbc6a95f9bdfad71e55998fec30c5cc0be490e921cbd796d2dbf0243f2f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 1946, sha256: null },
    ],
    bytes: 276564048,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-68m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '68M',
    note: 'Not usable yet.',
  },
  {
    id: 'ettin-reranker-150m',
    name: 'Ettin Reranker 150M',
    runtime: 'onnx',
    repo: 'cross-encoder/ettin-reranker-150m-v1',
    revision: '025501c4e0f9bbeb4c5b198318e0089ff061cc14',
    supported: false,
    unsupportedReason: 'Its ONNX export is the transformer only — the scoring head is a separate Sentence-Transformers module chain that Natively cannot run yet.',
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 596565114, sha256: '2c6968436957b7f295e1c60415fc955ba63cd142ba1b332c6cceb925fcb4cd4f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 2020, sha256: null },
    ],
    bytes: 600150461,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-150m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '150M',
    note: 'Not usable yet.',
  },

  // ── GGUF: needs llama.cpp, which Core does not ship ─────────────────────
  {
    id: 'jina-reranker-v3.5-q4km',
    name: 'Jina Reranker v3.5',
    runtime: 'gguf',
    repo: 'jinaai/jina-reranker-v3.5-GGUF',
    revision: '884f7c67aa3ac24edb89064da8c7bfd03f4a90f5',
    supported: true,
    files: [
      { repoPath: 'jina-reranker-v3.5-Q4_K_M.gguf', bytes: 396709504, sha256: '40ec64a1b8c18a40a79bbd7b516115aec158791e56452e734c36c52a76c245a1' },
    ],
    bytes: 396709504,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-reranker-v3.5-GGUF',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    params: '0.6B · Q4_K_M',
    note: 'Non-commercial licence. Runs through the Jina extension and llama.cpp.',
    extensionId: 'jina-reranker-v35',
    requiresBinary: 'llama-server',
  },
  {
    id: 'qwen3-reranker-0.6b-q4km',
    name: 'Qwen3 Reranker 0.6B',
    runtime: 'gguf',
    repo: 'QuantFactory/Qwen3-Reranker-0.6B-GGUF',
    revision: '9bdee8f1ad01d7896a20823d5affd66c494eee8b',
    supported: true,
    files: [
      { repoPath: 'Qwen3-Reranker-0.6B.Q4_K_M.gguf', bytes: 483835680, sha256: '783d816e7541ba78a5105f949a010217fecf31795c267d69ffa5a96403dff4a7' },
    ],
    bytes: 483835680,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/QuantFactory/Qwen3-Reranker-0.6B-GGUF', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '0.6B · Q4_K_M',
    note: 'Multilingual. Runs through the Qwen3 extension and llama.cpp.',
    extensionId: 'qwen3-reranker',
    requiresBinary: 'llama-server',
  },
];

export function findCatalogModel(id: string): LocalRerankerModel | null {
  return RERANKER_MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** The reranker that ships with Natively. Not installable; not removable. */
export const BUILT_IN_RERANKER = {
  id: 'bge-reranker-base',
  name: 'BGE Reranker Base',
  modelId: 'Xenova/bge-reranker-base',
  dtype: 'q8' as const,
};
