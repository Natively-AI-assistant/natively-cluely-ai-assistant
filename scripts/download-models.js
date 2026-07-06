const path = require('path');
const fs = require('fs');

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
        //    rerank escalation).
        //
        // 2026-07-06: NO LONGER bundled into resources/models/. The 266MB q8
        // model now downloads on FIRST document-grounded mode activation via
        // `electron/rag/rerankerDownloadProvider.ts` + `LocalModelDownloadService`.
        // This shrinks the installer by ~283MB for the >80% of users who never
        // invoke a custom document-grounded mode. The download is idempotent
        // (ModesManager.prewarmModeReferenceIndex triggers it; rerank stays
        // inert via the shared ONNX gate until the download completes).
        //
        // To pre-download the model into the user-data cache for offline
        // testing/dev, run instead:
        //   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
        //     -e "require('./dist-electron/electron/services/LocalModelDownloadService').LocalModelDownloadService.getInstance().start('reranker', 'Xenova/bge-reranker-base#q8')"
        console.log('[download-models] Skipping reranker (lazy-downloaded on first mode activation; see rerankerDownloadProvider).');

        console.log('[download-models] All models downloaded successfully!');
    } catch (e) {
        console.error('[download-models] Error downloading model:', e);
        process.exit(1);
    }
}

downloadModels().catch((e) => {
    console.error('[download-models] Fatal error:', e);
    process.exit(1);
});

