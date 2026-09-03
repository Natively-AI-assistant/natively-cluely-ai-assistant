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
 * THAT PROVISO USED TO EXCLUDE THE ETTIN ENTRIES, and no longer does. Their
 * `onnx/model.onnx` emits `last_hidden_state`, not `logits`: the export is the
 * transformer BACKBONE only, and the scoring head lives outside the graph as a
 * Sentence-Transformers module chain (`1_Pooling`, `2_Dense`, `3_LayerNorm`,
 * `4_Dense`). `rag/sentenceTransformerHead.ts` applies it, so those entries are
 * supported — but they are the reason a `logits` output is NOT a precondition
 * for listing a model.
 *
 * The precondition is narrower: every entry marked `supported: true` was
 * actually RUN before it was listed, and its scoring route is declared —
 * `logits` straight from the graph, an ST head applied on top, `rank` through
 * llama.cpp, or `yes-no` token probabilities. An entry whose route is unknown
 * does not get listed as supported.
 *
 * The GGUF entries run on llama.cpp, in-process, via node-llama-cpp. That
 * runtime only scores models with a ranking head: measured, bge-reranker-v2-m3
 * (arch bert) works, while jina-reranker-v3.5 and qwen3-reranker-0.6b are
 * qwen3-architecture generative models that llama.cpp refuses outright. Those
 * two are listed unsupported WITH THE REASON rather than offering a download
 * that cannot produce a score.
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
   * Fields to write into the downloaded `config.json`.
   *
   * Some repositories omit `model_type` and rely on `auto_map` pointing at
   * custom Python modelling code. transformers.js cannot execute that and fails
   * with "Unsupported model type: null" — jina-reranker-v2 is exactly this. The
   * architecture is standard (XLMRobertaForSequenceClassification) and the ONNX
   * graph is already traced, so naming the type is accurate rather than a
   * workaround; the custom code only ever covered flash attention, which a
   * traced graph does not use.
   *
   * Only applied to files the catalogue declares with `sha256: null`, so this
   * can never contradict a verified hash.
   */
  configPatch?: Record<string, unknown>;
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
  /**
   * How llama.cpp should score this model.
   *
   * 'rank' needs a ranking head (bge-reranker-v2-m3 has one). 'yes-no' is for a
   * causal LM with no such head, scored by the probability it puts on "yes"
   * against "no" — Qwen3-Reranker's own protocol. Getting this wrong is not a
   * degraded score, it is a refusal or a meaningless one.
   */
  scoring?: 'rank' | 'yes-no';
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
    modelId: 'cross-encoder/ettin-reranker-32m-v1',
    dtype: 'fp32',
    revision: 'b33e5ceb5110773ea9cf5e00c9bedc83a8c2afdd',
    supported: true,
    // Its ONNX graph emits last_hidden_state, not logits: the scoring head is
    // the Sentence-Transformers module chain below, applied by
    // rag/sentenceTransformerHead.ts. Hence the extra config + safetensors.
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 127737036, sha256: '31061d9f54e8303f5d95cf3433dcf99f50d5f6de283c3b8357452be8c824142f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 1730, sha256: null },
      { repoPath: '1_Pooling/config.json', bytes: 89, sha256: null },
      { repoPath: '2_Dense/config.json', bytes: 228, sha256: null },
      { repoPath: '3_LayerNorm/config.json', bytes: 24, sha256: null },
      { repoPath: '4_Dense/config.json', bytes: 213, sha256: null },
      { repoPath: 'modules.json', bytes: 678, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 488, sha256: null },
      { repoPath: '2_Dense/model.safetensors', bytes: 589912, sha256: null },
      { repoPath: '3_LayerNorm/model.safetensors', bytes: 3224, sha256: null },
      { repoPath: '4_Dense/model.safetensors', bytes: 1684, sha256: null },
    ],
    bytes: 131918633,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-32m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '32M',
    note: 'Ultra-light. Its scoring head runs outside the ONNX graph.',
  },
  {
    id: 'ettin-reranker-68m',
    name: 'Ettin Reranker 68M',
    runtime: 'onnx',
    repo: 'cross-encoder/ettin-reranker-68m-v1',
    modelId: 'cross-encoder/ettin-reranker-68m-v1',
    dtype: 'fp32',
    revision: 'd166fa88ddde3c42bc3ee92f7df476d941c8204a',
    supported: true,
    // Its ONNX graph emits last_hidden_state, not logits: the scoring head is
    // the Sentence-Transformers module chain below, applied by
    // rag/sentenceTransformerHead.ts. Hence the extra config + safetensors.
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 272978775, sha256: '95505bbc6a95f9bdfad71e55998fec30c5cc0be490e921cbd796d2dbf0243f2f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 1946, sha256: null },
      { repoPath: '1_Pooling/config.json', bytes: 89, sha256: null },
      { repoPath: '2_Dense/config.json', bytes: 228, sha256: null },
      { repoPath: '3_LayerNorm/config.json', bytes: 24, sha256: null },
      { repoPath: '4_Dense/config.json', bytes: 213, sha256: null },
      { repoPath: 'modules.json', bytes: 678, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 488, sha256: null },
      { repoPath: '2_Dense/model.safetensors', bytes: 1048664, sha256: null },
      { repoPath: '3_LayerNorm/model.safetensors', bytes: 4248, sha256: null },
      { repoPath: '4_Dense/model.safetensors', bytes: 2196, sha256: null },
    ],
    bytes: 277620876,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-68m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '68M',
    note: 'Close to the 150M in quality at half the download.',
  },
  {
    id: 'ettin-reranker-150m',
    name: 'Ettin Reranker 150M',
    runtime: 'onnx',
    repo: 'cross-encoder/ettin-reranker-150m-v1',
    modelId: 'cross-encoder/ettin-reranker-150m-v1',
    dtype: 'fp32',
    revision: '025501c4e0f9bbeb4c5b198318e0089ff061cc14',
    supported: true,
    // Its ONNX graph emits last_hidden_state, not logits: the scoring head is
    // the Sentence-Transformers module chain below, applied by
    // rag/sentenceTransformerHead.ts. Hence the extra config + safetensors.
    files: [
      { repoPath: 'onnx/model.onnx', bytes: 596565114, sha256: '2c6968436957b7f295e1c60415fc955ba63cd142ba1b332c6cceb925fcb4cd4f' },
      { repoPath: 'tokenizer.json', bytes: 3583327, sha256: null },
      { repoPath: 'config.json', bytes: 2020, sha256: null },
      { repoPath: '1_Pooling/config.json', bytes: 89, sha256: null },
      { repoPath: '2_Dense/config.json', bytes: 228, sha256: null },
      { repoPath: '3_LayerNorm/config.json', bytes: 24, sha256: null },
      { repoPath: '4_Dense/config.json', bytes: 213, sha256: null },
      { repoPath: 'modules.json', bytes: 678, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 488, sha256: null },
      { repoPath: '2_Dense/model.safetensors', bytes: 2359384, sha256: null },
      { repoPath: '3_LayerNorm/model.safetensors', bytes: 6296, sha256: null },
      { repoPath: '4_Dense/model.safetensors', bytes: 3220, sha256: null },
    ],
    bytes: 602521081,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/cross-encoder/ettin-reranker-150m-v1', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '150M',
    note: 'The strongest Ettin. Largest download of the three.',
  },

  {
    id: 'jina-reranker-v2-multilingual',
    name: 'Jina Reranker v2 Multilingual',
    runtime: 'onnx',
    repo: 'jinaai/jina-reranker-v2-base-multilingual',
    modelId: 'jinaai/jina-reranker-v2-base-multilingual',
    dtype: 'q8',
    revision: '9cfeff2df7d40d1b78e75e5e9cebec92a99813c9',
    supported: true,
    files: [
      { repoPath: 'onnx/model_quantized.onnx', bytes: 279577152, sha256: 'c5220cf8fe023f8aa0ed2a3eb787d4451a7f17cf53f6b787e35718dd4b8815c3' },
      { repoPath: 'tokenizer.json', bytes: 17082734, sha256: '3a56def25aa40facc030ea8b0b87f3688e4b3c39eb8b45d5702b3a1300fe2a20' },
      { repoPath: 'tokenizer_config.json', bytes: 1148, sha256: null },
      { repoPath: 'special_tokens_map.json', bytes: 964, sha256: null },
      { repoPath: 'config.json', bytes: 1102, sha256: null },
    ],
    bytes: 296663100,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-reranker-v2-base-multilingual',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    // Its config.json has no model_type and points auto_map at custom Python.
    configPatch: { model_type: 'xlm-roberta' },
    params: '278M · int8',
    note: 'Jina, multilingual, and a real cross-encoder — so unlike v3.5 it runs here today. Non-commercial licence.',
  },

  // ── GGUF, run by llama.cpp in-process (node-llama-cpp) ──────────────────
  {
    id: 'bge-reranker-v2-m3-q4km',
    name: 'BGE Reranker v2 m3',
    runtime: 'gguf',
    repo: 'gpustack/bge-reranker-v2-m3-GGUF',
    revision: '3093af03b1a635e67b084b1d8c03c5f5e020fd05',
    supported: true,
    recommended: true,
    files: [
      { repoPath: 'bge-reranker-v2-m3-Q4_K_M.gguf', bytes: 438376864, sha256: 'e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673' },
    ],
    bytes: 438376864,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF', commercialUseRestricted: false, requiresAcknowledgement: false },
    scoring: 'rank',
    params: '568M · Q4_K_M',
    note: 'Multilingual, and the strongest local reranker measured here. Runs on llama.cpp.',
  },

  // ── GGUF: downloadable, but with no runtime in this build ───────────────
  // Core DOES run GGUF in-process now (see GgufReranker). v3.5 is still out
  // of reach, and not for a reason Natively can fix — see unsupportedReason.
  {
    id: 'jina-reranker-v3.5-q4km',
    name: 'Jina Reranker v3.5',
    runtime: 'gguf',
    repo: 'jinaai/jina-reranker-v3.5-GGUF',
    revision: '884f7c67aa3ac24edb89064da8c7bfd03f4a90f5',
    supported: false,
    // Not our measurement alone, and not a judgement call: Jina's own GGUF
    // README requires a FORKED llama-embedding, and rerank.py:6 names the three
    // patches it needs. Two of them — per-token hidden states and the
    // non-causal encoder mode — are not even the subject of the open PR.
    unsupportedReason:
      'Downloadable, but nothing in this build can score it. Jina\u2019s own instructions require a forked llama-embedding '
      + '(github.com/littlewine/llama.cpp) carrying three patches upstream llama.cpp does not have: --output-token-ids for '
      + 'per-token hidden states, a non-causal encoder mode, and a sliding-window fix \u2014 the model marks 16 of its 28 '
      + 'layers as sliding_attention and the bundled runtime reads that pattern and then discards it (open PR '
      + 'ggml-org/llama.cpp#26286, untouched since 2026-07-31). The scoring head is not in the GGUF either; it is the '
      + 'separate projector.safetensors that downloads alongside it. To USE v3.5 today, choose Jina AI as your reranker '
      + 'provider above and add a Jina API key \u2014 the hosted service runs this exact model.',
    // The .gguf ALONE cannot score anything with any runtime: the scoring MLP
    // is deliberately not baked into it, and rerank.py needs the tokenizer for
    // its block splitting. Shipping only the weights would be an incomplete
    // artifact wearing the model's name.
    files: [
      { repoPath: 'jina-reranker-v3.5-Q4_K_M.gguf', bytes: 396709504, sha256: '40ec64a1b8c18a40a79bbd7b516115aec158791e56452e734c36c52a76c245a1' },
      { repoPath: 'projector.safetensors', bytes: 1573048, sha256: 'b14c3d97315ca33490e630218c821640f183180fd971c5c3242f5b81aadcedf9' },
      { repoPath: 'tokenizer.json', bytes: 11423225, sha256: '4e95945ab0cef486709f760b81efcc7a6e75747f9165d13ead29159737455803' },
    ],
    bytes: 409705777,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-reranker-v3.5-GGUF',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    params: '0.6B · Q4_K_M',
    note: 'Listwise reranker built on Qwen3-0.6B. The weights and the scoring projector both download; what is missing is a runtime — see below.',
  },
  {
    id: 'qwen3-reranker-0.6b-q4km',
    name: 'Qwen3 Reranker 0.6B',
    runtime: 'gguf',
    repo: 'QuantFactory/Qwen3-Reranker-0.6B-GGUF',
    revision: '9bdee8f1ad01d7896a20823d5affd66c494eee8b',
    supported: true,
    // No ranking head — llama.cpp's rank API refuses it. Scored instead by the
    // probability it puts on "yes" against "no", which is Qwen's own protocol.
    // See rag/qwenRerankPrompt.ts.
    scoring: 'yes-no',
    files: [
      { repoPath: 'Qwen3-Reranker-0.6B.Q4_K_M.gguf', bytes: 483835680, sha256: '783d816e7541ba78a5105f949a010217fecf31795c267d69ffa5a96403dff4a7' },
    ],
    bytes: 483835680,
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/QuantFactory/Qwen3-Reranker-0.6B-GGUF', commercialUseRestricted: false, requiresAcknowledgement: false },
    params: '0.6B · Q4_K_M',
    note: 'Multilingual, 100+ languages. Noticeably slower than the others: it runs a full language model per passage.',
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
