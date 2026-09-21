/**
 * Curated Local Embedding Model Catalog (2026-09-20).
 *
 * Provides a high-performance selection of local embedding models supporting both
 * ONNX (via @huggingface/transformers) and GGUF (via node-llama-cpp), optimized
 * for Apple Silicon (MacBook M4 Metal acceleration) and Windows laptops.
 */

export type EmbeddingRuntime = 'onnx' | 'gguf';

export interface CatalogFile {
  /** Path inside the repository. May be nested (e.g. `onnx/model_quantized.onnx`). */
  repoPath: string;
  bytes: number;
  /** null where Hugging Face publishes none — a non-LFS file. */
  sha256: string | null;
}

export interface LocalEmbeddingModel {
  id: string;
  name: string;
  runtime: EmbeddingRuntime;
  repo: string;
  /** Commit pinned at catalogue time (40-hex). The downloader fetches exactly this revision. */
  revision: string;
  dimensions: number;
  supportedDimensions?: number[];
  contextLength: number;
  files: CatalogFile[];
  /** Total download, summed from real file sizes. */
  bytes: number;
  license: {
    spdx: string;
    url: string;
    commercialUseRestricted: boolean;
    requiresAcknowledgement: boolean;
  };
  params: string;
  note: string;
  recommended?: boolean;
  bundled?: boolean;
  supported: boolean;
  unsupportedReason?: string;
  /** ONNX transformers.js model identifier */
  modelId?: string;
  /** GGUF file name within repository */
  ggufFile?: string;
  /** Preferred pooling strategy */
  pooling?: 'mean' | 'cls' | 'last';
}

export const EMBEDDING_MODEL_CATALOG: LocalEmbeddingModel[] = [
  // ── Bundled Baseline: MiniLM ───────────────────────────────────────────
  {
    id: 'minilm-l6-v2',
    name: 'MiniLM L6 v2',
    runtime: 'onnx',
    repo: 'Xenova/all-MiniLM-L6-v2',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 256,
    files: [
      { repoPath: 'config.json', bytes: 650, sha256: null },
      { repoPath: 'tokenizer.json', bytes: 711661, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 366, sha256: null },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
    ],
    bytes: 23685047,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '22.7M · q8',
    note: 'Bundled default with Natively. Instant (<10ms) and lightweight, suitable for quick notes.',
    bundled: true,
    supported: true,
    pooling: 'mean',
  },

  // ── Recommended: BGE Small EN v1.5 (ONNX) ──────────────────────────────
  {
    id: 'bge-small-en-v1.5',
    name: 'BGE Small EN v1.5',
    runtime: 'onnx',
    repo: 'Xenova/bge-small-en-v1.5',
    modelId: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 683, sha256: null },
      { repoPath: 'tokenizer.json', bytes: 711396, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 366, sha256: null },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 34014426, sha256: '6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4' },
    ],
    bytes: 34726871,
    license: {
      spdx: 'MIT',
      url: 'https://huggingface.co/Xenova/bge-small-en-v1.5',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '33.4M · q8',
    note: 'Best for MacBook Air & Windows: +15–20% retrieval accuracy over MiniLM with the same 384d speed and low RAM.',
    recommended: true,
    supported: true,
    pooling: 'mean',
  },

  // ── Qwen3 Embedding 0.6B (GGUF) ─────────────────────────────────────────
  {
    id: 'qwen3-embedding-0.6b-q4',
    name: 'Qwen3 Embedding 0.6B',
    runtime: 'gguf',
    repo: 'mradermacher/Qwen3-Embedding-0.6B-GGUF',
    revision: '8c605f43dcb0b43cf6e4afc7203888d912a67ace',
    dimensions: 1024,
    supportedDimensions: [512, 1024],
    contextLength: 8192,
    ggufFile: 'Qwen3-Embedding-0.6B.Q4_K_M.gguf',
    files: [
      { repoPath: 'Qwen3-Embedding-0.6B.Q4_K_M.gguf', bytes: 396475040, sha256: '793cb15c8e0da4fe29f32ae0b3d604a92a9b1ecf5048cbfd65107faa38108b83' },
    ],
    bytes: 396475040,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '0.6B · Q4_K_M',
    note: 'Ultra-fast 0.6B multilingual embedding model (396 MB). Runs on Apple Metal GPU and Windows with <500MB RAM.',
    recommended: true,
    supported: true,
    pooling: 'last',
  },

  // ── Qwen3 Embedding 4B (GGUF) ───────────────────────────────────────────
  {
    id: 'qwen3-embedding-4b-q4',
    name: 'Qwen3 Embedding 4B',
    runtime: 'gguf',
    repo: 'Qwen/Qwen3-Embedding-4B-GGUF',
    revision: 'f4602530db1d980e16da9d7d3a70294cf5c190be',
    dimensions: 2560,
    supportedDimensions: [1024, 2560],
    contextLength: 8192,
    ggufFile: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
    files: [
      { repoPath: 'Qwen3-Embedding-4B-Q4_K_M.gguf', bytes: 2496703776, sha256: '2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b' },
    ],
    bytes: 2496703776,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '4B · Q4_K_M',
    note: 'Flagship open embedding model with 2560d output (2.49 GB). Highest retrieval quality, runs smoothly on 16GB RAM.',
    supported: true,
    pooling: 'last',
  },

  // ── Jina Embeddings v4 (GGUF) ───────────────────────────────────────────
  {
    id: 'jina-embeddings-v4-q4',
    name: 'Jina Embeddings v4',
    runtime: 'gguf',
    repo: 'jinaai/jina-embeddings-v4-text-retrieval-GGUF',
    revision: '6c6ba828f6ad0faee901b4bce25d96faade908d1',
    dimensions: 1024,
    supportedDimensions: [1024],
    contextLength: 8192,
    ggufFile: 'jina-embeddings-v4-text-retrieval-Q4_K_M.gguf',
    files: [
      { repoPath: 'jina-embeddings-v4-text-retrieval-Q4_K_M.gguf', bytes: 1929900032, sha256: '4e24d1b6631fe21139b360001da86b519d40e1881a2c06f1183dda8aa0ba7fc1' },
    ],
    bytes: 1929900032,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    params: '3.8B · Q4_K_M',
    note: '8192-token context window with multi-document retrieval focus (1.92 GB). Advanced dense semantic embeddings.',
    supported: true,
    pooling: 'mean',
  },

  // ── Jina Embeddings v5 Text Small (GGUF) ─────────────────────────────────
  {
    id: 'jina-embeddings-v5-text-small',
    name: 'Jina Embeddings v5 Text Small',
    runtime: 'gguf',
    repo: 'jinaai/jina-embeddings-v5-text-small-retrieval-GGUF',
    revision: '78b0ebcb4c870fdfef409e578b65288b49a4fa90',
    dimensions: 1024,
    supportedDimensions: [1024],
    contextLength: 8192,
    ggufFile: 'v5-small-retrieval-Q4_K_M.gguf',
    files: [
      { repoPath: 'v5-small-retrieval-Q4_K_M.gguf', bytes: 396705152, sha256: '9440cf89f3e8a7a31a42e11b87e106dd5b344af4e0e3b6b21a96136cc8686e21' },
    ],
    bytes: 396705152,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-embeddings-v5-text-small-retrieval-GGUF',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    params: '0.6B · Q4_K_M',
    note: 'Modern Jina v5 architecture (396 MB) optimized for compact, high-relevance retrieval across diverse technical domains.',
    supported: true,
    pooling: 'mean',
  },

  // ── Jina Code Embeddings 0.5B (GGUF) ─────────────────────────────────────
  {
    id: 'jina-code-embeddings-0.5b',
    name: 'Jina Code Embeddings 0.5B',
    runtime: 'gguf',
    repo: 'jinaai/jina-code-embeddings-0.5b-GGUF',
    revision: '941797c2653f7f0425a06a860d5035f77a685731',
    dimensions: 768,
    supportedDimensions: [768],
    contextLength: 8192,
    ggufFile: 'jina-code-embeddings-0.5b-IQ4_NL.gguf',
    files: [
      { repoPath: 'jina-code-embeddings-0.5b-IQ4_NL.gguf', bytes: 352668224, sha256: '9c300fc3fa595f56b9f7cbc7af776d36781f724ab23c26f226752bd5d4eeedc1' },
    ],
    bytes: 352668224,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/jinaai/jina-code-embeddings-0.5b-GGUF',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '0.5B · IQ4_NL',
    note: 'Domain-trained embedding model for code search, repositories, ASTs, and programming language queries (352 MB).',
    supported: true,
    pooling: 'mean',
  },

  // ── Jina Code Embeddings 1.5B (GGUF) ────────────────────────────────────
  {
    id: 'jina-code-embeddings-1.5b-q4',
    name: 'Jina Code Embeddings 1.5B',
    runtime: 'gguf',
    repo: 'jinaai/jina-code-embeddings-1.5b-GGUF',
    revision: '2330b9417fd033091c2765c9b46ec97448cb91e6',
    dimensions: 1536,
    supportedDimensions: [1536],
    contextLength: 8192,
    ggufFile: 'jina-code-embeddings-1.5b-IQ4_NL.gguf',
    files: [
      { repoPath: 'jina-code-embeddings-1.5b-IQ4_NL.gguf', bytes: 936328384, sha256: '9fc43144462d5136d69e7e50584e974f490e918b6bb4556f8588187c65643460' },
    ],
    bytes: 936328384,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/jinaai/jina-code-embeddings-1.5b-GGUF',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '1.5B · IQ4_NL',
    note: 'Deep code intelligence and semantic matching for multi-language software codebases and documentation (936 MB).',
    supported: true,
    pooling: 'last',
  },
];

export function findEmbeddingCatalogModel(id: string): LocalEmbeddingModel | undefined {
  return EMBEDDING_MODEL_CATALOG.find(m => m.id === id);
}

export function listEmbeddingCatalogModels(): LocalEmbeddingModel[] {
  return EMBEDDING_MODEL_CATALOG;
}
