const path = require('path');
const fs = require('fs');

// Required core-fallback model files. The BGE reranker is also required for
// smart-retrieval Phase 1/3 (confidence-gated local rerank escalation) and is
// bundled so a clean-machine install never has to download a 280MB cross-encoder
// on first document-grounded mode activation.
const REQUIRED_MODEL_FILES = [
    'Xenova/all-MiniLM-L6-v2/config.json',
    'Xenova/all-MiniLM-L6-v2/tokenizer.json',
    'Xenova/all-MiniLM-L6-v2/tokenizer_config.json',
    'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
    'Xenova/mobilebert-uncased-mnli/config.json',
    'Xenova/mobilebert-uncased-mnli/tokenizer.json',
    'Xenova/mobilebert-uncased-mnli/tokenizer_config.json',
    'Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx',
    'Xenova/bge-reranker-base/config.json',
    'Xenova/bge-reranker-base/tokenizer.json',
    'Xenova/bge-reranker-base/tokenizer_config.json',
    'Xenova/bge-reranker-base/onnx/model_quantized.onnx',
];

function verifyModels() {
    const modelsDir = path.join(__dirname, '../resources/models');
    const missing = [];
    for (const rel of REQUIRED_MODEL_FILES) {
        const full = path.join(modelsDir, rel);
        let ok = false;
        try { ok = fs.existsSync(full) && fs.statSync(full).size > 0; } catch { ok = false; }
        if (!ok) missing.push(full);
    }
    if (missing.length > 0) {
        console.error('[download-models] VERIFY FAILED — required model files missing or empty:');
        for (const m of missing) console.error('  ✗', m);
        process.exit(1);
    }
    console.log('[download-models] VERIFY OK — all required core-fallback model files present.');
}

async function downloadModels() {
    const { pipeline, env } = await import('@huggingface/transformers');
    const modelsDir = path.join(__dirname, '../resources/models');
    
    // Ensure the directory exists
    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
    }

    // Let Transformers.js handle the download but specify the local directory cache
    env.cacheDir = modelsDir;
    
    try {
        // 1. Embedding model (RAG)
        console.log('[download-models] Downloading Xenova/all-MiniLM-L6-v2...');
        await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('[download-models] all-MiniLM-L6-v2 downloaded.');

        // 2. Zero-shot classification model (Intent Classifier)
        console.log('[download-models] Downloading Xenova/mobilebert-uncased-mnli...');
        await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
        console.log('[download-models] mobilebert-uncased-mnli downloaded.');

        // 3. Cross-encoder reranker (smart-retrieval Phase 1/3 — confidence-gated
        //    rerank escalation). Bundled in resources/models/ so a clean-machine
        //    install can do offline rerank without a 280MB first-activation
        //    download. The installer ships the q8 quantized variant (~280MB).
        //
        //    The lazy-download provider in electron/rag/rerankerDownloadProvider.ts
        //    still acts as a no-op fallback if the bundled model is absent
        //    (e.g. an old installer predating this bundling).
        console.log('[download-models] Downloading Xenova/bge-reranker-base (q8)...');
        // Use dtype:'q8' so transformers.js selects the quantized ONNX variant
        // (~280 MB) instead of the fp32 one (~1.1 GB). NATIVELY_RERANKER_DTYPE
        // override remains for accuracy experiments.
        const rerankerDtype = (process.env.NATIVELY_RERANKER_DTYPE || 'q8').trim() || 'q8';
        await pipeline('text-classification', 'Xenova/bge-reranker-base', { dtype: rerankerDtype });
        console.log('[download-models] bge-reranker-base downloaded.');

        console.log('[download-models] All models downloaded successfully!');
    } catch (e) {
        console.error('[download-models] Error downloading model:', e);
        process.exit(1);
    }
}

if (process.argv.includes('--verify')) {
    // Fail-loud, no-network check that required models are already on disk.
    verifyModels();
} else {
    downloadModels().catch((e) => {
        console.error('[download-models] Fatal error:', e);
        process.exit(1);
    });
}

