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
  /**
   * Prepended to QUERY text only (e5: "query: ", Arctic/BGE: a retrieval
   * instruction, Nomic: "search_query: "). Omitted for a symmetric model.
   * Not cosmetic: an asymmetric model fed bare text retrieves measurably worse.
   */
  queryPrefix?: string;
  /** Prepended to DOCUMENT/chunk text only (e5: "passage: "). */
  documentPrefix?: string;
}

/** The catalog id of the model that ships inside the app (electron/rag/bundledLocalEmbedding.ts). */
export const BUNDLED_CATALOG_ID = 'multilingual-e5-small';

export const EMBEDDING_MODEL_CATALOG: LocalEmbeddingModel[] = [
  // ── Bundled: Multilingual E5 Small (since 2026-09-22) ─────────────────
  {
    id: 'multilingual-e5-small',
    name: 'Multilingual E5 Small',
    runtime: 'onnx',
    repo: 'Xenova/multilingual-e5-small',
    modelId: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 658, sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' },
      { repoPath: 'tokenizer.json', bytes: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
      { repoPath: 'tokenizer_config.json', bytes: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' },
      { repoPath: 'special_tokens_map.json', bytes: 167, sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 118308185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
    ],
    bytes: 135392183,
    license: {
      spdx: 'MIT',
      url: 'https://huggingface.co/Xenova/multilingual-e5-small',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '118M · q8',
    note: "Shipped with Natively. Multilingual, including Hindi. Best dense retrieval of every model measured under 500 MB (R@10 0.334 against MiniLM 0.213), and it answers Hindi questions about English documents as well as English ones.",
    bundled: true,
    supported: true,
    pooling: 'mean',
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
  },

  // ── MiniLM L6 v2: bundled until 2026-09-21, now a download ──────────────
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
    note: 'The previous built-in model. Smallest and fastest; weakest retrieval of this list (R@10 0.213). English only.',
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
    note: 'Same 384-d width and memory as MiniLM, with a longer 512-token window. R@10 0.302 in the Natively benchmark. English only.',
    recommended: true,
    supported: true,
    // BGE v1.5 is a CLS-pooled model with a query instruction (its model card);
    // mean pooling and bare queries were this entry's earlier recipe.
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
  },

  // ── From the 2026-09-21 local embedding benchmark (docs/local-embedding-benchmark.md) ──
  // Recipes (pooling, prefixes) are the ones that benchmark verified; revisions
  // and every file's sha256 are the bytes it downloaded and measured.
  {
    id: 'snowflake-arctic-embed-xs',
    name: 'Snowflake Arctic Embed XS',
    runtime: 'onnx',
    repo: 'Snowflake/snowflake-arctic-embed-xs',
    modelId: 'Snowflake/snowflake-arctic-embed-xs',
    revision: 'd8c86521100d3556476a063fc2342036d45c106f',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 737, sha256: 'd7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec' },
      { repoPath: 'tokenizer.json', bytes: 711649, sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854' },
      { repoPath: 'tokenizer_config.json', bytes: 1433, sha256: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810' },
      { repoPath: 'special_tokens_map.json', bytes: 695, sha256: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 22972992, sha256: 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1' },
    ],
    bytes: 23687506,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Snowflake/snowflake-arctic-embed-xs',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '22.6M · q8',
    note: "MiniLM-sized. In the Natively benchmark it did not beat MiniLM (R@10 0.199 against 0.213). English only.",
    supported: true,
    pooling: 'cls',
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    documentPrefix: "",
  },

  {
    id: 'snowflake-arctic-embed-s',
    name: 'Snowflake Arctic Embed S',
    runtime: 'onnx',
    repo: 'Snowflake/snowflake-arctic-embed-s',
    modelId: 'Snowflake/snowflake-arctic-embed-s',
    revision: 'e596f507467533e48a2e17c007f0e1dacc837b33',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 703, sha256: '4e519aa92ec40943356032afe458c8829d70c5766b109e4a57490b82f72dcfb7' },
      { repoPath: 'tokenizer.json', bytes: 711649, sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854' },
      { repoPath: 'tokenizer_config.json', bytes: 1433, sha256: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810' },
      { repoPath: 'special_tokens_map.json', bytes: 695, sha256: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 34015111, sha256: 'f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14' },
    ],
    bytes: 34729591,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Snowflake/snowflake-arctic-embed-s',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '33.4M · q8',
    note: "Small and fast; clearly ahead of MiniLM (R@10 0.257 against 0.213). English only.",
    supported: true,
    pooling: 'cls',
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    documentPrefix: "",
  },

  {
    id: 'snowflake-arctic-embed-m',
    name: 'Snowflake Arctic Embed M',
    runtime: 'onnx',
    repo: 'Snowflake/snowflake-arctic-embed-m',
    modelId: 'Snowflake/snowflake-arctic-embed-m',
    revision: 'fc74610d18462d218e312aa986ec5c8a75a98152',
    dimensions: 768,
    supportedDimensions: [768],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 738, sha256: '2e26193d0d00a8c709c379fd840bd6c41789b25add0d324d841d0788d61b7e0e' },
      { repoPath: 'tokenizer.json', bytes: 711649, sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854' },
      { repoPath: 'tokenizer_config.json', bytes: 1381, sha256: '0e83e9d7206b3ade43f8f2aeef523cf5d5b4a25b67af21b273de21972c0f58b7' },
      { repoPath: 'special_tokens_map.json', bytes: 695, sha256: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 110084023, sha256: 'e46017484d369593d6bb830936fde2175ce21e1ba1ddf002f23e3212d87c824a' },
    ],
    bytes: 110798486,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/Snowflake/snowflake-arctic-embed-m',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '109M · q8',
    note: "Wider 768-d vectors (twice the index space). R@10 0.288. English only.",
    supported: true,
    pooling: 'cls',
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    documentPrefix: "",
  },

  {
    id: 'e5-small-v2',
    name: 'E5 Small v2',
    runtime: 'onnx',
    repo: 'Xenova/e5-small-v2',
    modelId: 'Xenova/e5-small-v2',
    revision: '02af79985278377e65c724a76275707cb0333c70',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 598, sha256: 'a45cbfdbc729148119afa0284a366fcaea47522a260790a02cd8aafba9fd5896' },
      { repoPath: 'tokenizer.json', bytes: 711396, sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66' },
      { repoPath: 'tokenizer_config.json', bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
      { repoPath: 'special_tokens_map.json', bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 34014367, sha256: '7d9092cb25f2bd1c023b7e8d2aa459044a02030ac880e5a59fdaf27af69f1ded' },
    ],
    bytes: 34726852,
    license: {
      spdx: 'MIT',
      url: 'https://huggingface.co/Xenova/e5-small-v2',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '33.4M · q8',
    note: "Strongest small English-only model in the Natively benchmark (R@10 0.320) at MiniLM’s width. English only.",
    recommended: true,
    supported: true,
    pooling: 'mean',
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
  },

  {
    id: 'gte-small',
    name: 'GTE Small',
    runtime: 'onnx',
    repo: 'Xenova/gte-small',
    modelId: 'Xenova/gte-small',
    revision: '5927d1727bb12db490052a1b33265ad78058de08',
    dimensions: 384,
    supportedDimensions: [384],
    contextLength: 512,
    files: [
      { repoPath: 'config.json', bytes: 601, sha256: '73f82cfb2bab7b9b7da090b2a71dac32f7ca79b12b2824d4caf9ecf0769b44ae' },
      { repoPath: 'tokenizer.json', bytes: 711661, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
      { repoPath: 'tokenizer_config.json', bytes: 557, sha256: '73687f47b47aedc8bfa8712f7e6616450058f1f1bb3d5e5861f8a92964d6467a' },
      { repoPath: 'special_tokens_map.json', bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 34014426, sha256: '18dec105109b6004369799ca4761fb8fb413c64172c02147bcfac186b5c5f6cb' },
    ],
    bytes: 34727370,
    license: {
      spdx: 'MIT',
      url: 'https://huggingface.co/Xenova/gte-small',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '33.4M · q8',
    note: "Symmetric (no query prefix). R@10 0.237, a modest gain over MiniLM. English only.",
    supported: true,
    pooling: 'mean',
    queryPrefix: "",
    documentPrefix: "",
  },

  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5',
    runtime: 'onnx',
    repo: 'nomic-ai/nomic-embed-text-v1.5',
    modelId: 'nomic-ai/nomic-embed-text-v1.5',
    revision: 'e9b6763023c676ca8431644204f50c2b100d9aab',
    dimensions: 768,
    supportedDimensions: [768],
    contextLength: 2048,
    files: [
      { repoPath: 'config.json', bytes: 2538, sha256: '9ab00bd92cee80a569f708140b7b6c1661a65891ff3765b1519e181ba2f2c92b' },
      { repoPath: 'tokenizer.json', bytes: 711396, sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66' },
      { repoPath: 'tokenizer_config.json', bytes: 1191, sha256: 'd7e0000bcc80134debd2222220427e6bf5fa20a669f40a0d0d1409cc18e0a9bc' },
      { repoPath: 'special_tokens_map.json', bytes: 695, sha256: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a' },
      { repoPath: 'onnx/model_quantized.onnx', bytes: 137296292, sha256: 'b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27' },
    ],
    bytes: 138012112,
    license: {
      spdx: 'Apache-2.0',
      url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5',
      commercialUseRestricted: false,
      requiresAcknowledgement: false,
    },
    params: '137M · q8',
    note: "Long 2048-token window and 768-d vectors. R@10 0.276. English only.",
    supported: true,
    pooling: 'mean',
    queryPrefix: "search_query: ",
    documentPrefix: "search_document: ",
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
    note: 'Multilingual. Runs through llama.cpp; its 1024-d vectors take about 2.7× the index space of MiniLM.',
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
    note: 'The largest model here. 2560-d vectors; needs several GB of free memory while indexing.',
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
    note: 'Retrieval variant of Jina Embeddings v4. Non-commercial licence.',
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
    note: 'Retrieval variant of Jina Embeddings v5 Text Small. Non-commercial licence.',
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
    note: 'Trained for code search: natural-language queries against source code.',
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
    note: 'Larger Jina code model, 1536-d vectors.',
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
