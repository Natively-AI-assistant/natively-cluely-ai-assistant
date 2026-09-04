// Regression test for: re-initializing the embedding pipeline abandoned a
// loaded local model.
//
// THE BUG. LocalEmbeddingProvider spawns a worker that loads the bundled MiniLM
// ONNX model, and the class had NO teardown at all — only `worker.unref?.()`,
// which lets the process exit but frees nothing. Meanwhile
// EmbeddingPipeline._doInitialize() runs again on every embedding-related
// config change and opens with:
//
//     this.fallbackProvider = new LocalEmbeddingProvider();
//
// overwriting the field. The instance being replaced kept its worker — and its
// loaded model — alive for the rest of the session, referenced by nothing.
//
// The trigger is ordinary: changing an embedding API key, model or provider in
// Settings re-initializes the pipeline.
//
// PLATFORM. This matters far more on Windows than on the machine it was found
// on. On macOS the Gemini embedding path usually wins, so the local model never
// loads; on Windows the Gemini embedding key returns 403 and the resolver
// demotes to this bundled local model — so the abandoned copy is real there.
// Requires physical Windows verification.
//
// THE FIX, guarded here: LocalEmbeddingProvider.dispose() terminates the worker
// and rejects anything in flight, and the pipeline disposes the outgoing local
// providers before replacing them — deduped by identity, because `provider` and
// `fallbackProvider` are deliberately the same object in local-only mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { LocalEmbeddingProvider } = require(
    path.join(repoRoot, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js'),
);

// The constructor reads Electron's `app.isPackaged` to resolve the model path,
// and `app` does not exist under ELECTRON_RUN_AS_NODE. These tests are about the
// teardown protocol, not path resolution, so they build an instance off the
// prototype and populate only the fields dispose() touches.
function bareProvider() {
    const provider = Object.create(LocalEmbeddingProvider.prototype);
    provider.worker = null;
    provider.loadingPromise = null;
    provider.pendingRequests = new Map();
    return provider;
}

test('LocalEmbeddingProvider exposes a dispose()', () => {
    assert.equal(
        typeof LocalEmbeddingProvider.prototype.dispose,
        'function',
        'without a dispose() there is no way to release the worker holding the ONNX model; ' +
        'unref() only lets the process exit, it frees nothing.',
    );
});

test('dispose() is safe on a provider that never loaded, and is idempotent', async () => {
    const provider = bareProvider();
    await provider.dispose();
    await provider.dispose();
});

test('dispose() terminates the worker and clears the handle', async () => {
    const provider = bareProvider();
    let terminated = 0;
    // Stand in for a loaded worker without spawning a real ONNX thread.
    provider.worker = { terminate: async () => { terminated += 1; }, on() {}, unref() {} };
    provider.loadingPromise = Promise.resolve();

    await provider.dispose();

    assert.equal(terminated, 1, 'dispose() must terminate the worker holding the model');
    assert.equal(provider.worker, null, 'the worker handle must be cleared so a later load starts clean');
    assert.equal(provider.loadingPromise, null, 'a stale loadingPromise would short-circuit the next load');
});

test('dispose() rejects pending work only when there is no worker left to answer it', async () => {
    // Rejecting is right when nothing can ever reply — otherwise the caller
    // hangs until some outer timeout notices. It is NOT right while a live
    // worker still owes a reply; see the in-flight test below, which is the
    // case that loses meeting/reference chunks.
    const provider = bareProvider();
    provider.worker = null;

    let rejected;
    const orphaned = new Promise((resolve, reject) => {
        provider.pendingRequests.set(1, { resolve, reject, timer: setTimeout(() => {}, 60_000) });
    }).catch((e) => { rejected = e; });

    await provider.dispose('replaced by a new embedding configuration');
    await orphaned;

    assert.ok(rejected, 'with no worker, a pending embed must reject rather than hang forever');
    assert.match(String(rejected.message), /replaced by a new embedding configuration/);
    assert.equal(provider.pendingRequests.size, 0, 'pending map must be cleared');
});

test('the pipeline disposes local providers before replacing them', () => {
    // Source-level: _doInitialize is not reachable without a full app config,
    // but the ordering is the whole point — disposing AFTER the reassignment
    // would release the new instance and leak the old one.
    const source = require('node:fs').readFileSync(
        path.join(repoRoot, 'electron/rag/EmbeddingPipeline.ts'), 'utf8',
    );
    const disposeAt = source.indexOf('await this.disposeLocalProviders()');
    const assignAt = source.indexOf('this.fallbackProvider = new LocalEmbeddingProvider()');
    assert.ok(disposeAt > 0, 'EmbeddingPipeline must dispose the outgoing local providers on re-init');
    assert.ok(
        disposeAt < assignAt,
        'disposeLocalProviders() must run BEFORE fallbackProvider is reassigned — after the ' +
        'reassignment it would dispose the new instance and leak the old one.',
    );
    assert.match(
        source,
        /seen\.has\(candidate\)/,
        'the dispose loop must dedupe by identity: provider and fallbackProvider are the same ' +
        'object in local-only mode.',
    );
});

test('dispose() lets an IN-FLIGHT embed finish instead of failing it', async () => {
    // THE CONSTRAINT. A rejected embed LOSES chunks — LiveRAGIndexer only warns
    // ("Failed to embed live chunk batch") and moves on. So a config change made
    // while a meeting is recording, or while reference files are being ingested,
    // must never reject work already in flight. The original dispose() called
    // rejectAllPending() immediately, which did exactly that.
    //
    // Completing them under the OLD provider is safe: RAGManager filters
    // retrieval by getActiveSpaceKey(), so vectors written in a superseded
    // embedding space are simply never retrieved. They cannot corrupt anything.
    //
    // MEASURED 2026-09-04 against the real all-MiniLM-L6-v2 worker, 400 embeds
    // genuinely in flight (pendingRequests.size === 400) when dispose lands —
    // the reference-file-ingestion shape:
    //
    //     immediate reject (before):   0/400 succeeded, all "replaced by a new
    //                                  embedding configuration"
    //     detach-drain    (after) : 400/400 succeeded, 384 dims, dispose
    //                                  returned in 0ms
    //
    // The 0ms matters as much as the 400: initializeEmbeddings() is awaited by
    // the set-config IPC, so a blocking drain would freeze Settings for as long
    // as the batch runs.
    //
    // Boundary worth knowing: an embed STARTED after dispose (rather than
    // already posted) can still be rejected by the old worker's exit handler,
    // because pendingRequests is shared per-instance. Production does not hit
    // it — _doInitialize replaces the provider, so nothing calls embed() on the
    // disposed instance — but do not rely on a disposed provider accepting new
    // work.
    const provider = bareProvider();
    let terminated = false;
    provider.worker = { terminate: async () => { terminated = true; }, on() {}, unref() {} };

    let settled = 'pending';
    const inFlight = new Promise((resolve, reject) => {
        provider.pendingRequests.set(1, { resolve, reject, timer: setTimeout(() => {}, 60_000) });
    }).then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

    const disposing = provider.dispose('replaced by a new embedding configuration');

    // dispose() must not block its caller on the drain: initializeEmbeddings is
    // awaited by the set-config IPC, and blocking there freezes Settings.
    await disposing;
    assert.equal(settled, 'pending', 'dispose() must not reject work that is still in flight');
    assert.equal(terminated, false, 'the worker must stay alive while it still owes a reply');

    // The reply arrives late, the way a real worker's would.
    provider.pendingRequests.get(1).resolve({ vectors: [[0.1, 0.2]] });
    provider.pendingRequests.delete(1);
    await inFlight;
    assert.equal(settled, 'resolved', 'the in-flight embed must complete normally');

    // Only once nothing is owed does the worker go.
    for (let i = 0; i < 60 && !terminated; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(terminated, 'the worker must be terminated once it has drained');
});
