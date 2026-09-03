// DEV-ONLY visual harness for the Reranker settings panel. Not shipped — same
// precedent as embeddingSettingsHarness.tsx.
//
// WHY: this panel has to read as the same surface as Settings > Embeddings, and
// that can only be judged by looking at it. Settings mounts one tab at a time
// behind the real main process, so this stubs `window.electronAPI` with a
// realistic state and renders the REAL component against the REAL index.css.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { RerankerSettings } from '../components/settings/RerankerSettings';

// A mid-flight state, deliberately: one model downloaded and active, one still
// downloadable, the Ettin entries unsupported, an extension present but off,
// and an OpenRouter key configured. Anything that renders only in one state is
// not being looked at.
const CATALOG_MODELS = [
    {
        id: 'ms-marco-minilm-l6', name: 'MS MARCO MiniLM L6', runtime: 'onnx', repo: 'Xenova/ms-marco-MiniLM-L-6-v2',
        params: '22M · int8', note: 'Tiny and quick. The lightest option that actually reranks.',
        bytes: 23857086, recommended: false,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'installed', bytesOnDisk: 23857086, selected: true,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: true, unsupportedReason: null, activatable: true,
    },
    {
        id: 'mxbai-rerank-xsmall', name: 'mxbai Rerank XSmall', runtime: 'onnx', repo: 'mixedbread-ai/mxbai-rerank-xsmall-v1',
        params: '70M · int8', note: 'A good default: small download, noticeably better than the built-in.',
        bytes: 95898326, recommended: true,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: true, unsupportedReason: null, activatable: true,
    },
    {
        id: 'bge-reranker-large', name: 'BGE Reranker Large', runtime: 'onnx', repo: 'Xenova/bge-reranker-large',
        params: '560M · int8', note: 'Highest quality of the local models measured — but the slowest to load.',
        bytes: 580038433, recommended: false,
        license: { spdx: 'MIT', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: true, unsupportedReason: null, activatable: true,
    },
    {
        id: 'ettin-reranker-150m', name: 'Ettin Reranker 150M', runtime: 'onnx', repo: 'cross-encoder/ettin-reranker-150m-v1',
        params: '150M', note: 'Not usable yet.', bytes: 600150461, recommended: false,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: false,
        unsupportedReason: 'Its ONNX export is the transformer only — the scoring head is a separate Sentence-Transformers module chain that Natively cannot run yet.',
        activatable: false,
    },
    {
        id: 'bge-reranker-v2-m3-q4km', name: 'BGE Reranker v2 m3', runtime: 'gguf', repo: 'gpustack/bge-reranker-v2-m3-GGUF',
        params: '568M · Q4_K_M', note: 'Multilingual, and the strongest local reranker measured here. Runs on llama.cpp.',
        bytes: 438376864, recommended: true,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: true, unsupportedReason: null, activatable: true,
    },
    {
        id: 'qwen3-reranker-0.6b-q4km', name: 'Qwen3 Reranker 0.6B', runtime: 'gguf', repo: 'QuantFactory/Qwen3-Reranker-0.6B-GGUF',
        params: '0.6B · Q4_K_M', note: 'Multilingual, 100+ languages. Noticeably slower than the others: it runs a full language model per passage.',
        bytes: 483835680, recommended: false,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: true, unsupportedReason: null, activatable: true,
    },
    {
        id: 'jina-reranker-v3.5-q4km', name: 'Jina Reranker v3.5', runtime: 'gguf', repo: 'jinaai/jina-reranker-v3.5-GGUF',
        params: '0.6B · Q4_K_M', note: 'Not usable yet — see below.', bytes: 396709504, recommended: false,
        license: { spdx: 'CC-BY-NC-4.0', url: '#', commercialUseRestricted: true, requiresAcknowledgement: true },
        state: 'not-installed', bytesOnDisk: 0, selected: false,
        extensionId: null, extensionInstalled: null, requiresBinary: null,
        supported: false,
        unsupportedReason: 'It is a listwise reranker: one forward pass over the query and every passage at once, scored from the hidden state at N+2 specific token positions. llama.cpp exposes pooled embeddings and logits, not per-token hidden states.',
        activatable: false,
    },
];

const EXTENSIONS = [{
    id: 'ettin-reranker', name: 'Ettin Reranker', version: '1.0.0', type: 'reranker',
    author: 'community', homepage: '#', source: 'local:/x', enabled: false, running: false,
    disabledReason: null, permissions: ['filesystem.models'],
    models: [{
        key: 'ettin-32m-model', format: 'onnx', approxBytes: 127737036,
        state: 'ready', bytes: 127737036, reason: null,
        license: { spdx: 'Apache-2.0', url: '#', commercialUseRestricted: false, requiresAcknowledgement: false, acknowledged: true },
    }],
}];

// `?slow=1` delays every stub so the loading state can actually be looked at.
const params = new URLSearchParams(location.search);
const SLOW = params.has('slow');
const HANG = params.has('hang');   // never resolves — the stuck-skeleton repro
const delay = <T,>(v: T): Promise<T> =>
    HANG ? new Promise<T>(() => {})
        : SLOW ? new Promise(r => setTimeout(() => r(v), 4000))
            : Promise.resolve(v);

(window as any).electronAPI = {
    getRerankerStatus: async () => delay({
        provider: 'local',
        openrouterModel: 'voyageai/rerank-2.5-lite',
        candidateCount: 15, topN: 5, fallbackToLocal: false,
        hasApiKey: true, eligible: false, ineligibleReason: 'provider-not-selected',
        ineligibleMessage: 'The reranker provider is set to Local.',
        builtIn: { id: 'bge-reranker-base', name: 'BGE Reranker Base', bundled: true, cached: true, available: true },
        effective: { kind: 'local', id: 'ms-marco-minilm-l6' },
        lastTest: { at: '2026-09-01T10:00:00Z', model: 'voyageai/rerank-2.5-lite', latencyMs: 412, ok: true },
    } as any),
    getRerankerCatalog: async () => ({
        stale: false, fetchedAt: Date.now(),
        models: [
            { id: 'voyageai/rerank-2.5-lite', label: 'VoyageAI: rerank-2.5-lite', vendor: 'voyageai', contextLength: 32000, free: false, multimodal: false, group: 'recommended', note: '32K context' },
            { id: 'voyageai/rerank-2.5', label: 'VoyageAI: rerank-2.5', vendor: 'voyageai', contextLength: 32000, free: false, multimodal: false, group: 'quality', note: '32K context' },
            { id: 'cohere/rerank-4-fast', label: 'Cohere: Rerank 4 Fast', vendor: 'cohere', contextLength: 32768, free: false, multimodal: false, group: 'fast', note: '33K context' },
            { id: 'nvidia/llama-nemotron-rerank-vl-1b-v2:free', label: 'NVIDIA: Nemotron Rerank VL', vendor: 'nvidia', contextLength: 10240, free: true, multimodal: true, group: 'multimodal', note: '10K context · multimodal · free tier' },
        ],
    }),
    listLocalRerankerModels: async () => ({ models: CATALOG_MODELS, selectedId: 'ms-marco-minilm-l6', builtInSelected: false }),
    listExtensions: async () => ({ available: true, extensions: EXTENSIONS }),
    setRerankerConfig: async () => ({ success: true }),
    useLocalRerankerModel: async () => ({ success: true }),
    installLocalRerankerModel: async () => ({ success: true }),
    removeLocalRerankerModel: async () => ({ success: true }),
    cancelLocalRerankerModel: async () => ({ success: true }),
    setRerankerOpenRouterKey: async () => ({ success: true }),
    testReranker: async () => ({ success: true, latencyMs: 412, costUsd: 0.000031 }),
    installExtensionFromFolder: async () => ({ success: false, error: 'cancelled' }),
    setExtensionEnabled: async () => ({ success: true }),
    removeExtension: async () => ({ success: true }),
    acknowledgeExtensionLicense: async () => ({ success: true }),
    downloadExtensionModel: async () => ({ success: true }),
    cancelExtensionModelDownload: async () => ({ success: true }),
    browseExtensionRegistry: async () => ({ ok: true, entries: [] }),
    onLocalRerankerModelProgress: () => () => {},
    onExtensionModelProgress: () => () => {},
    platform: 'darwin',
    openExternal: () => {},
};

function Harness() {
    // Mirrors the real Settings panel container: dark canvas, the width the
    // overlay gives a tab, and the theme attribute the --aip-* scope reads.
    return (
        <div data-theme="dark" style={{ background: 'var(--bg-main, #0b0b0c)', minHeight: '100vh', padding: 24 }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <RerankerSettings />
            </div>
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
