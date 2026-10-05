// Fixture data + `window.electronAPI` stub for the Embeddings settings panel.
// It sits beside the harnesses rather than in a `fixtures/` directory on
// purpose: .gitignore carries a blanket `fixtures/` rule, so a file under one
// would be silently untracked and every harness would break on a fresh clone.
// Extracted from embeddingSettingsHarness.tsx so retrievalSettingsHarness can
// merge it with the Reranker stub — the combined panel mounts BOTH components
// and needs one electronAPI carrying both halves.
// DEV-ONLY visual harness for the Embeddings settings panel. Not part of the
// shipped app (see the thinkingDotHarness.tsx / streamingCodeHarness.tsx
// precedent and their sibling *.html entries).
//
// WHY: the panel has to read as the same surface as AI Providers, and that can
// only be judged by looking at it. Settings mounts one tab at a time behind the
// real main process, so this stubs `window.electronAPI` with a realistic
// catalogue and renders the REAL component against the REAL index.css cascade —
// no mocked styling, no re-implemented markup.

// Realistic fixture: Ollama running with three embedders, an OpenAI key present,
// no Gemini key, no Natively key, MiniLM currently active.
const CATALOG = {
    providers: [
        {
            id: 'natively', name: 'Natively', cloud: true, managed: true,
            available: true,
            models: [{ id: 'gemini-embedding-2', label: 'gemini-embedding-2', dimensions: 3072, dimensionsVerified: true, recommended: true, note: 'Managed by Natively. Nothing to configure.' }],
        },
        {
            id: 'ollama', name: 'Ollama', cloud: false, available: true,
            models: [
                { id: 'qwen3-embedding:8b', label: 'qwen3-embedding:8b', dimensions: 4096, dimensionsVerified: false },
                { id: 'nomic-embed-text', label: 'nomic-embed-text', dimensions: 768, dimensionsVerified: false },
                { id: 'all-minilm:latest', label: 'all-minilm:latest', dimensions: 384, dimensionsVerified: false },
            ],
        },
        {
            id: 'voyage', name: 'Voyage AI', cloud: true, available: true,
            models: [
                { id: 'voyage-4', label: 'voyage-4', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], recommended: true, note: 'General purpose. 32k context.' },
                { id: 'voyage-4-large', label: 'voyage-4-large', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Quality tier. 32k context.' },
                { id: 'voyage-4-lite', label: 'voyage-4-lite', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Cost and latency. 32k context.' },
                { id: 'voyage-multimodal-3.5', label: 'voyage-multimodal-3.5', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Multimodal. 32k context.' },
                { id: 'voyage-code-4', label: 'voyage-code-4', dimensions: 1024, dimensionsVerified: true, note: 'Code retrieval. Fixed 1024 dimensions.' },
                { id: 'voyage-law-2', label: 'voyage-law-2', dimensions: 1024, dimensionsVerified: true, note: 'Legal. 16k context, fixed 1024 dimensions.' },
            ],
        },
        {
            id: 'openrouter', name: 'OpenRouter', cloud: true, available: true,
            models: [
                { id: 'voyageai/voyage-4-lite', label: 'voyageai/voyage-4-lite', dimensions: 0, dimensionsVerified: false, supportedDimensions: [256, 512, 1024, 2048], pricePerMillion: 0.02, note: 'VoyageAI by MongoDB: voyage-4-lite · 32000 token context · $0.02/1M tokens' },
                { id: 'voyageai/voyage-4', label: 'voyageai/voyage-4', dimensions: 0, dimensionsVerified: false, supportedDimensions: [256, 512, 1024, 2048], pricePerMillion: 0.06, note: 'VoyageAI by MongoDB: voyage-4 · 32000 token context · $0.06/1M tokens' },
                { id: 'nvidia/nemotron-3-embed-1b:free', label: 'nvidia/nemotron-3-embed-1b:free', dimensions: 0, dimensionsVerified: false, pricePerMillion: 0, note: 'NVIDIA: Nemotron Embed · 32768 token context · free' },
                { id: 'google/gemini-embedding-2', label: 'google/gemini-embedding-2', dimensions: 0, dimensionsVerified: false, supportedDimensions: [768, 1536, 3072], pricePerMillion: 0.15, note: 'Google: Gemini Embedding 2 · 8192 token context · $0.15/1M tokens' },
            ],
        },
        {
            id: 'custom', name: 'Custom endpoint', cloud: false, available: true,
            endpoint: 'http://localhost:1234/v1', capabilityUnknown: false,
            models: [
                { id: 'text-embedding-nomic-embed-text-v2', label: 'text-embedding-nomic-embed-text-v2', dimensions: 768, dimensionsVerified: false },
                { id: 'bge-m3', label: 'bge-m3', dimensions: 1024, dimensionsVerified: false },
            ],
        },
        {
            id: 'openai', name: 'OpenAI', cloud: true, available: true,
            models: [
                { id: 'text-embedding-3-small', label: 'text-embedding-3-small', dimensions: 1536, dimensionsVerified: true, supportedDimensions: [512, 1536], recommended: true, note: 'Default 1536 dimensions. Supports shortening via the dimensions parameter.' },
                { id: 'text-embedding-3-large', label: 'text-embedding-3-large', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [256, 1024, 3072], note: 'Default 3072 dimensions. Supports shortening via the dimensions parameter.' },
                { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002', dimensions: 1536, dimensionsVerified: true, note: 'Previous generation. Fixed at 1536 dimensions.' },
            ],
        },
        {
            id: 'gemini', name: 'Gemini', cloud: true, available: true,
            models: [
                { id: 'gemini-embedding-2', label: 'gemini-embedding-2', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [768, 1536, 3072], recommended: true, note: 'Current model, and multimodal — accepts text, images, audio and video.' },
                { id: 'gemini-embedding-001', label: 'gemini-embedding-001', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [768, 1536, 3072], note: 'Text only. Supports 128-3072 dimensions; 768, 1536 and 3072 are recommended.' },
            ],
        },
        {
            id: 'local', name: 'Built-in', cloud: false, available: true,
            models: [
                { id: 'Xenova/all-MiniLM-L6-v2', label: 'MiniLM', dimensions: 384, dimensionsVerified: true, lightweight: true, note: 'Bundled with Natively. Small and fast; weaker retrieval on large projects.' },
                { id: 'nomic-embed-text', label: 'nomic-embed-text', dimensions: 768, dimensionsVerified: true, note: 'Pulled automatically when Ollama is available.' },
            ],
        },
    ],
};

// The Local Embeddings library card. One row per state it renders differently:
// bundled, downloadable, installed-but-unused (Use/Test/Remove), and a
// licence-gated entry (the inline warning). Without this the card showed an
// empty well, so its model-name colour was never on screen here.
const LICENSE = { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', commercialUseRestricted: false, requiresAcknowledgement: false };
const LOCAL_MODEL_BASE = {
    runtime: 'onnx' as const, supported: true, unsupportedReason: null, activatable: true,
    acknowledged: true, recommended: false, selected: false, license: LICENSE,
};
const LOCAL_MODELS = [
    {
        ...LOCAL_MODEL_BASE, id: 'multilingual-e5-small', name: 'Multilingual E5 Small', bundled: true,
        repo: 'Xenova/multilingual-e5-small', params: '118M', bytes: 135_000_000, bytesOnDisk: 135_000_000,
        dimensions: 384, state: 'installed' as const,
        note: 'Bundled default. Multilingual, and answers Hindi questions about English documents as well as English ones.',
    },
    {
        ...LOCAL_MODEL_BASE, id: 'all-minilm-l6-v2', name: 'MiniLM L6 v2',
        repo: 'Xenova/all-MiniLM-L6-v2', params: '22.7M', bytes: 24_000_000, bytesOnDisk: 0,
        dimensions: 384, state: 'not-installed' as const,
        note: 'The previous built-in model. Smallest and fastest; weakest retrieval of this list. English only.',
    },
    {
        ...LOCAL_MODEL_BASE, id: 'bge-small-en-v1.5', name: 'BGE Small EN v1.5', recommended: true,
        repo: 'Xenova/bge-small-en-v1.5', params: '33.4M', bytes: 35_000_000, bytesOnDisk: 35_000_000,
        dimensions: 384, state: 'installed' as const, license: { ...LICENSE, spdx: 'MIT' },
        note: 'Same 384-d width and memory as MiniLM, with a longer 512-token window. English only.',
    },
    {
        ...LOCAL_MODEL_BASE, id: 'embeddinggemma-300m', name: 'EmbeddingGemma 300M', runtime: 'gguf' as const,
        repo: 'unsloth/embeddinggemma-300m-GGUF', params: '300M', bytes: 330_000_000, bytesOnDisk: 0,
        dimensions: 768, state: 'not-installed' as const, acknowledged: false,
        license: { spdx: 'Gemma', url: 'https://ai.google.dev/gemma/terms', commercialUseRestricted: false, requiresAcknowledgement: true },
        note: 'Licence-gated: the download stays disabled until its terms are accepted.',
    },
];

// `?lightweight=1` puts the panel in the state that renders the compatibility
// -default warning under the Active Embedding Model row. The default stub
// reports a strong cloud model, so that strip is otherwise unreachable here.
const LIGHTWEIGHT = new URLSearchParams(location.search).get('lightweight') === '1';

export const EMBEDDING_SETTINGS_API = {
    getEmbeddingStatus: async () => (LIGHTWEIGHT ? {
        active: {
            configured: true, provider: 'local', model: 'Xenova/all-MiniLM-L6-v2',
            dimensions: 384, space: 'local:xenova/all-minilm-l6-v2:384',
            location: 'on-device', lightweight: true,
        },
        configured: { mode: 'auto' },
        acknowledged: false,
        scopeAllowsCloud: true,
        shouldWarn: true,
    } : {
        active: {
            configured: true, provider: 'gemini', model: 'gemini-embedding-2',
            dimensions: 3072, space: 'gemini:gemini-embedding-2:3072',
            location: 'cloud', lightweight: false,
        },
        configured: { mode: 'auto' },
        acknowledged: true,
        scopeAllowsCloud: true,
        shouldWarn: false,
    }),
    getEmbeddingCatalog: async () => ({ ...CATALOG, hasCatalog: { openai: false, gemini: true } }),
    testEmbeddingModel: async () => ({ ok: true, model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, latencyMs: 12 }),
    setEmbeddingConfig: async () => ({ success: true, reindexRequired: true }),
    acknowledgeLightweightEmbeddings: async () => ({ success: true }),
    fetchEmbeddingModels: async () => ({ success: true, models: [], count: 0 }),
    setEmbeddingVoyageKey: async () => ({ success: true }),
    setEmbeddingOpenRouterKey: async () => ({ success: true, models: [], count: 0 }),
    setEmbeddingCustomEndpoint: async () => ({ success: true, endpoint: 'http://localhost:1234/v1', models: [], reachable: true }),
    listLocalEmbeddingModels: async () => ({ models: LOCAL_MODELS }),
    platform: 'darwin',
    openExternal: () => {},
};
