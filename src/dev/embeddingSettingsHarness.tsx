// DEV-ONLY visual harness for the Embeddings settings panel. Not part of the
// shipped app (see the thinkingDotHarness.tsx / streamingCodeHarness.tsx
// precedent and their sibling *.html entries).
//
// WHY: the panel has to read as the same surface as AI Providers, and that can
// only be judged by looking at it. Settings mounts one tab at a time behind the
// real main process, so this stubs `window.electronAPI` with a realistic
// catalogue and renders the REAL component against the REAL index.css cascade —
// no mocked styling, no re-implemented markup.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { EmbeddingSettings } from '../components/settings/EmbeddingSettings';

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

(window as any).electronAPI = {
    getEmbeddingStatus: async () => ({
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
    platform: 'darwin',
    openExternal: () => {},
};

function Harness() {
    // Mirrors the real Settings panel container: dark canvas, the width the
    // overlay gives a tab, and the theme attribute the --aip-* scope reads.
    return (
        <div data-theme="dark" style={{ background: 'var(--bg-main, #0b0b0c)', minHeight: '100vh', padding: 24 }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <EmbeddingSettings />
            </div>
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
