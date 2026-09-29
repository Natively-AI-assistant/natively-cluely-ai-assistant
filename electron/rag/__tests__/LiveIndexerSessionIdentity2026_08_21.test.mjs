// CR-02 (code-review HIGH, 2026-08-21): stop() can park ~90s on an in-flight
// tick, and start() calls stop() WITHOUT awaiting it. The R-03 guard that was
// supposed to stop a late resumption from tearing down the NEXT session
// compared meetingId VALUES — but the only production caller passes the literal
// constant 'live-meeting-current' (electron/main.ts), so the comparison always
// held and the guard never fired. Session identity must be a monotonic token.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { LiveRAGIndexer } = await import(
    pathToFileURL(path.resolve(here, '../../..', 'dist-electron/electron/rag/LiveRAGIndexer.js')).href
);

const LIVE_ID = 'live-meeting-current'; // the ONLY id production ever passes

const makeIndexer = (parked) => {
    const vectorStore = {
        saveChunks: (chunks) => chunks.map((_, i) => `c${i}`),
        storeEmbedding: () => {},
        stampMeetingSpaceIfUnset: () => {},
        restampMeetingSpaceOnChange: () => {},
    };
    const embeddingPipeline = {
        isReady: () => true,
        getEmbeddingsWithFallback: async (t) => {
            await parked; // stands in for ForegroundGate + provider latency
            return { embeddings: t.map(() => [0.1, 0.2]), space: 's', provider: 'p', dimensions: 2 };
        },
        getProviderInfo: () => ({ provider: 'p', dimensions: 2, space: 's' }),
    };
    return new LiveRAGIndexer(vectorStore, embeddingPipeline);
};

const seg = (i) => ({
    speaker: i % 2 ? 'interviewer' : 'user',
    text: `Transcript segment number ${i}, long enough to survive preprocessing and chunking.`,
    timestamp: 1_700_000_000_000 + i * 1000,
});

test("a stale stop() must not tear down the session that started after it", async () => {
    let release;
    const parked = new Promise((r) => { release = r; });
    const ix = makeIndexer(parked);

    // Session A, with a tick parked inside the embedding call.
    ix.start(LIVE_ID);
    ix.feedSegments(Array.from({ length: 8 }, (_, i) => seg(i)));
    const tickA = ix.tick(true);
    await new Promise((r) => setImmediate(r));

    // A ends; production does NOT await this.
    const stoppingA = ix.stop();

    // Session B starts while A's stop() is parked. Same meeting id — which is
    // exactly why a value comparison cannot tell the two sessions apart.
    ix.start(LIVE_ID);
    ix.feedSegments(Array.from({ length: 8 }, (_, i) => seg(100 + i)));
    assert.equal(ix.isRunning(), true, 'session B should be running right after start()');

    // A's tick completes and A's stop() resumes.
    release();
    await tickA.catch(() => {});
    await stoppingA.catch(() => {});
    await new Promise((r) => setTimeout(r, 50));

    try {
        assert.equal(
            ix.isRunning(), true,
            "session B was torn down by session A's stale stop() — the identity guard did not fire. "
            + 'It must compare a monotonic session token, not the meetingId string, which is a constant.',
        );
        assert.equal(ix.getActiveMeetingId(), LIVE_ID, 'session B must still own the live meeting id');
    } finally {
        await ix.stop().catch(() => {});
        // If the guard regresses, A's stop() runs its reset while `this.timer`
        // already belongs to B, and the reset does NOT clear it — so B's 30s
        // interval leaks and the runner never drains. That hang would MASK the
        // assertion above. Clear it directly so a regression reports as a clean
        // failure rather than a timeout.
        if (ix.timer) { clearInterval(ix.timer); ix.timer = null; }
    }
});

test('a normal (non-overlapped) stop still resets the session', async () => {
    const ix = makeIndexer(Promise.resolve());
    ix.start(LIVE_ID);
    ix.feedSegments(Array.from({ length: 8 }, (_, i) => seg(i)));
    await ix.stop();
    assert.equal(ix.isRunning(), false, 'an unopposed stop must still tear the session down');
    assert.equal(ix.getActiveMeetingId(), null);
});
