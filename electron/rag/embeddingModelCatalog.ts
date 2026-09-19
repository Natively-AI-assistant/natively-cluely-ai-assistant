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
  /** Commit pinned at catalogue time. Downloader prefers live branch if matching. */
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
    revision: 'main',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 256,
    files: [
      { repoPath: 'config.json', bytes: 650, sha256: null },
      { repoPath: 'tokenizer.json', bytes: 711549, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 399, sha256: null },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 23028881, sha256: null },
    ],
    bytes: 23741479,
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
    revision: 'main',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 1343, sha256: null },
      { repoPath: 'tokenizer.json', bytes: 711463, sha256: null },
      { repoPath: 'tokenizer_config.json', bytes: 366, sha256: null },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 33411244, sha256: null },
    ],
    bytes: 34124416,
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
    revision: 'main',
    dimensions: 1024,
    supportedDimensions: [512, 1024],
    contextLength: 8192,
    ggufFile: 'Qwen3-Embedding-0.6B.Q4_K_M.gguf',
    files: [
      { repoPath: 'Qwen3-Embedding-0.6B.Q4_K_M.gguf', bytes: 396475040, sha256: null },
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
    revision: 'main',
    dimensions: 2560,
    supportedDimensions: [1024, 2560],
    contextLength: 8192,
    ggufFile: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
    files: [
      { repoPath: 'Qwen3-Embedding-4B-Q4_K_M.gguf', bytes: 2496703776, sha256: null },
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
    revision: 'main',
    dimensions: 1024,
    supportedDimensions: [1024],
    contextLength: 8192,
    ggufFile: 'jina-embeddings-v4-text-retrieval-Q4_K_M.gguf',
    files: [
      { repoPath: 'jina-embeddings-v4-text-retrieval-Q4_K_M.gguf', bytes: 1929900032, sha256: null },
    ],
    bytes: 1929900032,
    license: {
      spdx: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    },
    params: '580M · Q4_K_M',
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
    revision: 'main',
    dimensions: 1024,
    supportedDimensions: [1024],
    contextLength: 8192,
    ggufFile: 'v5-small-retrieval-Q4_K_M.gguf',
    files: [
      { repoPath: 'v5-small-retrieval-Q4_K_M.gguf', bytes: 396705152, sha256: null },
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
    revision: 'main',
    dimensions: 768,
    supportedDimensions: [768],
    contextLength: 8192,
    ggufFile: 'jina-code-embeddings-0.5b-IQ4_NL.gguf',
    files: [
      { repoPath: 'jina-code-embeddings-0.5b-IQ4_NL.gguf', bytes: 352668224, sha256: null },
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
    revision: 'main',
    dimensions: 1536,
    supportedDimensions: [1536],
    contextLength: 8192,
    ggufFile: 'jina-code-embeddings-1.5b-IQ4_NL.gguf',
    files: [
      { repoPath: 'jina-code-embeddings-1.5b-IQ4_NL.gguf', bytes: 936328384, sha256: null },
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
