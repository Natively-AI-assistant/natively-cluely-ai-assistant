// Regression test for the generalized ONNX load sentinel (2026-07-08).
//
// The generalized sentinel module (`electron/utils/onnxLoadSentinel.ts`)
// keys by `{family, modelId}` with one file per family. The Whisper family's
// pre-existing behavior is byte-equivalent; this suite gates every primitive
// + the cross-family isolation property (the load-bearing reason we chose
// one-file-per-family over one shared JSON file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-load-sentinel-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
    if (request === 'electron') {
        return { app: { getPath: () => userData, isReady: () => true } };
    }
    return origLoad.apply(this, arguments);
};

const sentinelPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/utils/onnxLoadSentinel.js',
);
const {
    writeLoadSentinel,
    clearLoadSentinel,
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    ONNX_LOAD_SENTINEL_TTL_MS,
} = await import(pathToFileURL(sentinelPath).href);

function fileFor(family) {
    return path.join(userData, `onnx-load-sentinel-${family}.json`);
}

test('defaults: NATIVELY_ONNX_SENTINEL_DISABLED is OFF; primitives active', () => {
    delete process.env.NATIVELY_ONNX_SENTINEL_DISABLED;
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    assert.ok(fs.existsSync(fileFor('intent')), 'sentinel file should exist after write');
    clearLoadSentinel('intent');
});

test('NATIVELY_ONNX_SENTINEL_DISABLED=1 short-circuits all writes + reads', () => {
    process.env.NATIVELY_ONNX_SENTINEL_DISABLED = '1';
    try {
        writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
        assert.ok(
            !fs.existsSync(fileFor('intent')),
            'disabled state must not create a sentinel file',
        );
        const result = consumePoisonedOnnxLoad('intent');
        assert.equal(result, null, 'disabled state must not return any record');
    } finally {
        delete process.env.NATIVELY_ONNX_SENTINEL_DISABLED;
    }
    // Recover cleanly so later tests don't see leftover state.
    clearLoadSentinel('intent');
});

test('write → consume returns the record + removes the file', () => {
    clearLoadSentinel('intent');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    assert.ok(fs.existsSync(fileFor('intent')));
    const consumed = consumePoisonedOnnxLoad('intent');
    assert.ok(consumed, 'consume should return the record');
    assert.equal(consumed.family, 'intent');
    assert.equal(consumed.modelId, 'Xenova/mobilebert-uncased-mnli');
    assert.equal(consumed.attempt, 1);
    assert.ok(!fs.existsSync(fileFor('intent')), 'consume must remove the file');
});

test('write → clear → consume returns null', () => {
    clearLoadSentinel('intent');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    clearLoadSentinel('intent');
    assert.ok(!fs.existsSync(fileFor('intent')));
    const consumed = consumePoisonedOnnxLoad('intent');
    assert.equal(consumed, null);
});

test('repeated writes for the same modelId increment attempt', () => {
    clearLoadSentinel('intent');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    const consumed = consumePoisonedOnnxLoad('intent');
    assert.equal(consumed.attempt, 3);
});

test('clearLoadSentinel(family, modelId) does not clobber a different modelId', () => {
    clearLoadSentinel('embeddings');
    writeLoadSentinel('embeddings', 'Xenova/all-MiniLM-L6-v2');
    clearLoadSentinel('embeddings', 'Xenova/all-MiniLM-L6-v2-distilled'); // no-op
    const persisted = JSON.parse(fs.readFileSync(fileFor('embeddings'), 'utf-8'));
    assert.equal(persisted.modelId, 'Xenova/all-MiniLM-L6-v2');
    clearLoadSentinel('embeddings');
});

test('consume is idempotent across calls', () => {
    clearLoadSentinel('reranker');
    writeLoadSentinel('reranker', 'Xenova/bge-reranker-base');
    const first = consumePoisonedOnnxLoad('reranker');
    assert.ok(first);
    const second = consumePoisonedOnnxLoad('reranker');
    assert.equal(second, null, 'second consume must be a no-op');
});

test('atomic write leaves no .tmp behind', () => {
    clearLoadSentinel('reranker');
    writeLoadSentinel('reranker', 'Xenova/bge-reranker-base');
    assert.ok(!fs.existsSync(`${fileFor('reranker')}.tmp`), 'no tmp file should survive');
    clearLoadSentinel('reranker');
});

test('cross-family isolation: writing one family does not touch another', () => {
    // The whole reason we chose per-family files: two families writing
    // concurrently must not lose either record (the lost-update bug a
    // shared JSON store would suffer under read-modify-write).
    for (const family of ['whisper', 'intent', 'embeddings', 'reranker']) {
        clearLoadSentinel(family);
    }
    writeLoadSentinel('whisper', 'Xenova/whisper-tiny.en');
    writeLoadSentinel('intent', 'Xenova/mobilebert-uncased-mnli');
    writeLoadSentinel('embeddings', 'Xenova/all-MiniLM-L6-v2');
    writeLoadSentinel('reranker', 'Xenova/bge-reranker-base');

    // Consuming one must not affect any other.
    assert.ok(consumePoisonedOnnxLoad('whisper'));
    assert.ok(consumePoisonedOnnxLoad('embeddings'));

    for (const family of ['intent', 'reranker']) {
        const consumed = consumePoisonedOnnxLoad(family);
        assert.ok(consumed, `${family} should still have its sentinel after the others were consumed`);
        assert.ok(fs.existsSync(fileFor(family)) === false, `${family} should be cleared after consume`);
    }
});

test('readSentinel treats corrupt / partial / wrong-family JSON as absent', () => {
    fs.writeFileSync(fileFor('whisper'), '{ "family": "intent" }', 'utf-8'); // wrong family
    assert.equal(consumePoisonedOnnxLoad('whisper'), null);

    fs.writeFileSync(fileFor('whisper'), '{ not even valid json', 'utf-8');
    assert.equal(consumePoisonedOnnxLoad('whisper'), null);

    fs.writeFileSync(fileFor('whisper'), JSON.stringify({
        family: 'whisper', modelId: 'Xenova/whisper-tiny.en', startedAt: 'NaN', attempt: 1,
    }), 'utf-8');
    assert.equal(consumePoisonedOnnxLoad('whisper'), null);

    clearLoadSentinel('whisper');
});

test('isSentinelWithinTtl: startedAt just now is in-Ttl; well outside is out', () => {
    const recent = {
        family: 'whisper', modelId: 'Xenova/whisper-tiny.en',
        startedAt: Date.now() - 1000, attempt: 1,
    };
    const stale = {
        family: 'whisper', modelId: 'Xenova/whisper-tiny.en',
        startedAt: Date.now() - (ONNX_LOAD_SENTINEL_TTL_MS + 60_000), attempt: 1,
    };
    assert.equal(isSentinelWithinTtl(recent), true);
    assert.equal(isSentinelWithinTtl(stale), false);
});
