// Tests the byte-weighted download-progress aggregator against the
// esbuild-compiled module in dist-electron/.
// Run via: npm run build:electron && node --test electron/audio/__tests__/
//
// What this guards against: regressing to the original COUNT-weighted average
// that made the download bar jump to ~80% the instant the tiny metadata files
// landed, then stall for the whole real download. Each case below asserts a
// property the byte-weighted aggregation must hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aggPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/whisper/whisperProgressAggregator.js',
);
const modelMgrPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const { WhisperProgressAggregator } = await import(pathToFileURL(aggPath).href);
const { getModelSizeBytes } = await import(pathToFileURL(modelMgrPath).href);

const MB = 1024 * 1024;

// Feed a sequence of events, return the array of posted percentages (nulls
// dropped) so a test can assert the full curve the renderer would see.
function run(agg, events) {
    const posted = [];
    for (const e of events) {
        const { pct } = agg.update(e);
        if (pct !== null) posted.push(pct);
    }
    return posted;
}

test('does NOT jump to ~80% when tiny metadata files complete first (the bug)', () => {
    // 1 big weight file (200MB) + 5 tiny JSON files (~5KB each). The old
    // count-average reported (5*100 + 1*0)/6 ≈ 83% the moment metadata landed.
    const agg = new WhisperProgressAggregator(200 * MB);
    const tiny = 5 * 1024;
    const posted = [];
    // All 5 tiny files complete instantly.
    for (let i = 0; i < 5; i++) {
        agg.update({ file: `meta${i}.json`, status: 'progress', loaded: tiny, total: tiny });
        const r = agg.update({ file: `meta${i}.json`, status: 'done' });
        if (r.pct !== null) posted.push(r.pct);
    }
    // After all metadata, the bar must still be ~0% (25KB of 200MB), NOT 80%.
    const afterMeta = posted.length ? posted[posted.length - 1] : 0;
    assert.ok(afterMeta <= 1, `expected ≤1% after metadata, got ${afterMeta}`);
});

test('tracks real byte progress dominated by the big weight file', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    const big = 100 * MB;
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 25 * MB, total: big }]).at(-1), 25);
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 50 * MB, total: big }]).at(-1), 50);
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 99 * MB, total: big }]).at(-1), 99);
});

test('caps at 99 — never reports 100 (completion is owned by the ready signal)', () => {
    const agg = new WhisperProgressAggregator(10 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 10 * MB, total: 10 * MB },
        { file: 'w.onnx', status: 'done' },
    ]);
    assert.equal(posted.at(-1), 99);
    assert.ok(!posted.includes(100));
});

test('is monotonic — never decreases even as new files enlarge the denominator', () => {
    const agg = new WhisperProgressAggregator(0); // force observed-totals path
    const posted = run(agg, [
        { file: 'a.onnx', status: 'progress', loaded: 50 * MB, total: 50 * MB }, // 100→99 capped
        // A second, larger file appears AFTER the first looked complete.
        { file: 'b.onnx', status: 'progress', loaded: 0, total: 150 * MB },
        { file: 'b.onnx', status: 'progress', loaded: 75 * MB, total: 150 * MB },
    ]);
    // Each posted value must be >= the previous one.
    for (let i = 1; i < posted.length; i++) {
        assert.ok(posted[i] >= posted[i - 1], `decreased: ${posted[i - 1]} → ${posted[i]}`);
    }
});

test('UNDER-estimated expectedBytes self-corrects via observed totals (no >100%)', () => {
    // Estimate 50MB but the real file is 200MB. Denominator must switch to the
    // observed 200MB so we never exceed 99%.
    const agg = new WhisperProgressAggregator(50 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 100 * MB, total: 200 * MB },
    ]);
    assert.equal(posted.at(-1), 50); // 100/200, not 100/50=200% clamped
});

test('OVER-estimated expectedBytes keeps the bar a lower bound (finishes below 99)', () => {
    // Estimate 200MB but the real download is only 100MB. The bar tracks
    // loaded/200MB and reaches ~50% at real completion — never a premature 99.
    const agg = new WhisperProgressAggregator(200 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 50 * MB, total: 100 * MB },
        { file: 'w.onnx', status: 'progress', loaded: 100 * MB, total: 100 * MB },
        { file: 'w.onnx', status: 'done' },
    ]);
    assert.equal(posted.at(-1), 50); // 100MB / 200MB. Completion handled by ready signal.
});

test('expectedBytes=0 falls back to observed file totals', () => {
    const agg = new WhisperProgressAggregator(0);
    assert.equal(
        run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 30 * MB, total: 60 * MB }]).at(-1),
        50,
    );
});

test('non-finite / negative expectedBytes is sanitized to 0 (observed-totals path)', () => {
    for (const bad of [NaN, -100, undefined, Infinity, 'nonsense']) {
        const agg = new WhisperProgressAggregator(bad);
        assert.equal(
            run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 10 * MB, total: 40 * MB }]).at(-1),
            25,
            `bad input ${String(bad)} should behave as 0`,
        );
    }
});

test('cached model with no progress events posts nothing (terminal state via ready)', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    // initiate/download statuses must not seed entries or post.
    const posted = run(agg, [
        { file: 'w.onnx', status: 'initiate' },
        { file: 'w.onnx', status: 'download' },
    ]);
    assert.deepEqual(posted, []);
});

test('progress event without byte totals uses percentage against a prior total only', () => {
    const agg = new WhisperProgressAggregator(0);
    // First, establish a total for the file via a byte-carrying event.
    run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 20 * MB, total: 100 * MB }]); // 20%
    // Now a no-total event arrives carrying only progress=60 (%) — applies to 100MB.
    const posted = run(agg, [{ file: 'w.onnx', status: 'progress', progress: 60 }]);
    assert.equal(posted.at(-1), 60);
});

test('progress event without ANY prior total cannot inflate the bar', () => {
    const agg = new WhisperProgressAggregator(0);
    // No byte total ever seen for this file → percentage-only event is ignored.
    const posted = run(agg, [{ file: 'mystery', status: 'progress', progress: 90 }]);
    assert.deepEqual(posted, []);
});

test('events with no file/name key are ignored', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    const posted = run(agg, [{ status: 'progress', loaded: 50 * MB, total: 100 * MB }]);
    assert.deepEqual(posted, []);
});

test('done before any total for that file does not seed a phantom entry', () => {
    const agg = new WhisperProgressAggregator(0);
    const posted = run(agg, [{ file: 'meta.json', status: 'done' }]);
    assert.deepEqual(posted, []);
});

test('getModelSizeBytes returns bytes for a known id and 0 for unknown', () => {
    // Moonshine Tiny is 26MB in the catalog.
    assert.equal(getModelSizeBytes('onnx-community/moonshine-tiny-ONNX'), Math.round(26 * MB));
    assert.equal(getModelSizeBytes('does/not-exist'), 0);
    assert.equal(getModelSizeBytes(''), 0);
    assert.equal(getModelSizeBytes(undefined), 0);
});
