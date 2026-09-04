const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

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
    // The bundled cross-encoder. ms-marco replaced bge-reranker-base on
    // 2026-09-04 — see step 3 below for the numbers. bge's own weights are
    // deliberately absent from this list; its three tracked JSON files stay in
    // resources/models/ so the lazy downloader has a directory to fill, but
    // requiring them here would fail a build that never fetches the weights.
    'Xenova/ms-marco-MiniLM-L-6-v2/config.json',
    'Xenova/ms-marco-MiniLM-L-6-v2/tokenizer.json',
    'Xenova/ms-marco-MiniLM-L-6-v2/tokenizer_config.json',
    'Xenova/ms-marco-MiniLM-L-6-v2/onnx/model_quantized.onnx',
];

// OPTIONAL assets (review#9): verified with a WARNING, never a failure — the
// runtime degrades without them. The packaged-release gate
// (verify-packaged-local-assets.mjs) is the one place they stay REQUIRED.
const OPTIONAL_MODEL_FILES = [
    'pipecat-ai/smart-turn-v3/smart-turn-v3.1-cpu.onnx',
];

/** Plain HTTPS download with redirects, to a temp path, then sha256-verified rename. */
function downloadVerified(url, dest, expectedSha256, expectedBytes) {
    return new Promise((resolve, reject) => {
        const tmp = dest + '.part';
        const get = (u, redirects) => {
            https.get(u, { headers: { 'User-Agent': 'natively-download-models' } }, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
                    res.resume();
                    return get(new URL(res.headers.location, u).toString(), redirects + 1);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${u}`)); }
                const hash = crypto.createHash('sha256');
                const out = fs.createWriteStream(tmp);
                let bytes = 0;
                res.on('data', (c) => { hash.update(c); bytes += c.length; });
                res.pipe(out);
                out.on('finish', () => {
                    const digest = hash.digest('hex');
                    if (digest !== expectedSha256) { fs.rmSync(tmp, { force: true }); return reject(new Error(`sha256 mismatch for ${dest}: ${digest} != ${expectedSha256}`)); }
                    if (expectedBytes && bytes !== expectedBytes) { fs.rmSync(tmp, { force: true }); return reject(new Error(`size mismatch for ${dest}: ${bytes} != ${expectedBytes}`)); }
                    fs.renameSync(tmp, dest);
                    resolve();
                });
                out.on('error', reject);
            }).on('error', reject);
        };
        get(url, 0);
    });
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Smart Turn v3.1: manifest-driven, idempotent (skips when the on-disk hash already matches). */
async function downloadSmartTurn(modelsDir) {
    const dir = path.join(modelsDir, 'pipecat-ai', 'smart-turn-v3');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const dest = path.join(dir, manifest.file);
    if (fs.existsSync(dest) && sha256File(dest) === manifest.sha256) {
        console.log('[download-models] smart-turn-v3.1 already present (sha256 OK).');
        return;
    }
    console.log(`[download-models] Downloading ${manifest.model}/${manifest.file} (${(manifest.bytes / 1e6).toFixed(1)} MB, ${manifest.license})...`);
    await downloadVerified(manifest.url, dest, manifest.sha256, manifest.bytes);
    console.log('[download-models] smart-turn-v3.1 downloaded and sha256-verified.');
}

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
    for (const rel of OPTIONAL_MODEL_FILES) {
        const full = path.join(modelsDir, rel);
        let ok = false;
        try { ok = fs.existsSync(full) && fs.statSync(full).size > 0; } catch { ok = false; }
        if (!ok) console.warn(`[download-models] optional asset missing (feature degrades gracefully): ${rel}`);
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
        // dtype MUST be explicit on transformers.js v3 (we ship 3.8.1). v2 defaulted to
        // the quantized variant and honored `quantized: true`; v3 ignores that flag and
        // defaults to fp32, so a bare `pipeline(...)` call writes onnx/model.onnx while
        // REQUIRED_MODEL_FILES below — and electron/services/LocalFallbackAssets.ts, and
        // scripts/verify-packaged-local-assets.mjs — all require onnx/model_quantized.onnx.
        // Left implicit, every clean install silently produces the wrong filename and the
        // build dies at verify:packaged-local-assets. 'q8' is what maps to
        // model_quantized.onnx; see the same reasoning at electron/rag/LocalReranker.ts.
        const QUANTIZED = { dtype: 'q8' };

        // 1. Embedding model (RAG)
        console.log('[download-models] Downloading Xenova/all-MiniLM-L6-v2 (q8)...');
        await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', QUANTIZED);
        console.log('[download-models] all-MiniLM-L6-v2 downloaded.');

        // 2. Zero-shot classification model (Intent Classifier)
        console.log('[download-models] Downloading Xenova/mobilebert-uncased-mnli (q8)...');
        await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', QUANTIZED);
        console.log('[download-models] mobilebert-uncased-mnli downloaded.');

        // 3. Cross-encoder reranker — ms-marco-MiniLM-L-6-v2 (q8, ~24MB).
        //
        //    REPLACED bge-reranker-base on 2026-09-04. Measured against a
        //    NO-RERANKER baseline on a 40-passage pool with same-topic
        //    distractors (docs/reranker-benchmark-2026-09-04.md):
        //
        //      bge-reranker-base    MRR 0.7558   -0.0810   +3/-7   1873ms  283MB
        //      ms-marco-MiniLM-L-6  MRR 0.8688   +0.0320   +4/-2    211ms   24MB
        //
        //    The old default was the worst reranker in that table: it shipped
        //    283MB of installer in order to make retrieval measurably worse.
        //    This one is a twelfth of the size, nine times faster, and actually
        //    improves the ranking — so the low-confidence escalation in
        //    ModeHybridRetriever has a beneficiary again.
        //
        //    bge is still reachable for anyone who wants it: it stays in the
        //    catalogue and rerankerDownloadProvider.ts fetches it on demand.
        console.log('[download-models] Downloading Xenova/ms-marco-MiniLM-L-6-v2 (q8)...');
        await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', QUANTIZED);
        console.log('[download-models] ms-marco-MiniLM-L-6-v2 downloaded.');

        // 4. Smart Turn v3.1 (Auto Answer V3 TurnPredictor). Raw ONNX, not a
        //    transformers.js pipeline: fetched by URL and sha256-verified against
        //    resources/models/pipecat-ai/smart-turn-v3/manifest.json.
        //    OPTIONAL (review#9): the runtime degrades to the deterministic
        //    endpoint path without it, so a blocked download must not fail the
        //    install. Release builds are still gated by
        //    verify-packaged-local-assets.mjs, which requires the file.
        try {
            await downloadSmartTurn(modelsDir);
        } catch (e) {
            console.warn('[download-models] smart-turn-v3.1 download failed (optional; Auto Answer runs deterministic-only):', e?.message ?? e);
        }

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

