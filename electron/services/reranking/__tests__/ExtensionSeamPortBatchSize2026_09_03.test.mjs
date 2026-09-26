// Regression test for: the extension seam port declared no batchSize, so one
// query became five RPC round trips.
//
// THE BUG. RerankerRegistry.resolvePort() returned the extension branch as a
// bare `{ rerank }` with no `batchSize`:
//
//     return { rerank: (query, passages) => this.rerankVia(extensionId, ...) };
//
// RerankSeamPort.batchSize's own docstring says a port whose cost is a round
// trip rather than a forward pass must declare a larger size, and both other
// seam ports do exactly that — OpenRouterReranker and GgufReranker each declare
// Number.MAX_SAFE_INTEGER. The extension branch was the one that did not, so
// ModeHybridRetriever fell back to RERANK_BATCH_SIZE = 6 (an ONNX arena-memory
// measure, not a latency one) and split a 30-candidate pool into 5 sequential
// calls into the utilityProcess.
//
// Two consequences:
//   1. Each call carries its OWN full timeout budget, so the documented 10s
//      ceiling became a 50s worst case.
//   2. Each call re-runs the `running()` / `load()` check, which is what let a
//      single query race itself into starting the same extension twice (see
//      ExtensionManagerConcurrentLoad2026_09_03).
//
// The neighbouring hosted wrapper already carries a comment about this exact
// hazard — "Dropping it would silently restore the seam's default batching and
// turn one request into five" — and forwards `hosted.batchSize`. This test
// holds the extension branch to the same rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const { RerankerRegistry } = require(
    path.join(repoRoot, 'dist-electron/electron/services/reranking/RerankerRegistry.js'),
);

/** The pool ModeHybridRetriever hands the seam. */
const POOL_SIZE = 30;

function registryWithExtension() {
    return new RerankerRegistry({
        isEnabled: () => true,
        source: {
            list: () => [{ id: 'ext-reranker', enabled: true, manifest: { type: 'reranker' } }],
            running: () => ['ext-reranker'],
            load: async () => {},
            rerank: async () => null,
        },
    });
}

test('the extension seam port takes the whole candidate pool in one call', () => {
    const port = registryWithExtension().resolvePort();
    assert.ok(port, 'an enabled reranker extension should resolve a seam port');
    assert.ok(
        typeof port.batchSize === 'number' && port.batchSize >= POOL_SIZE,
        `the extension port declared batchSize=${String(port.batchSize)}. An extension rerank is ` +
        'an RPC into a utilityProcess, so it must take the pool in one call; anything below the ' +
        `${POOL_SIZE}-candidate pool size restores the seam's default batching of 6 and turns one ` +
        'query into 5 sequential round trips, each with its own full timeout budget.',
    );
});

test('the extension port matches the other round-trip ports', () => {
    // OpenRouterReranker and GgufReranker both declare Number.MAX_SAFE_INTEGER.
    // A port that is cheap per call but expensive per round trip has no reason
    // to differ between transports.
    const port = registryWithExtension().resolvePort();
    assert.equal(
        port.batchSize,
        Number.MAX_SAFE_INTEGER,
        'the extension port should use the same sentinel as the other round-trip seam ports',
    );
});

test('no extension enabled still resolves nothing from this branch', () => {
    const registry = new RerankerRegistry({
        isEnabled: () => true,
        source: {
            list: () => [{ id: 'ext-reranker', enabled: false, manifest: { type: 'reranker' } }],
            running: () => [],
            load: async () => {},
            rerank: async () => null,
        },
    });
    assert.equal(registry.resolvePort(), null, 'a disabled extension must not take the seam');
});
