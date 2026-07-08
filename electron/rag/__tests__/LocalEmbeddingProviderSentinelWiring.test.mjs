// Regression test for the local embedding provider's ONNX load-sentinel
// wiring (2026-07-08). Source-structural; mirrors IntentClassifierSentinelWiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function readSrc(relPath) {
    return fs.readFileSync(path.resolve(root, relPath), 'utf8');
}

test('LocalEmbeddingProvider writes the onnx load sentinel before new Worker(...)', () => {
    const src = readSrc('electron/rag/providers/LocalEmbeddingProvider.ts');
    const write = src.indexOf("writeOnnxLoadSentinel('embeddings',");
    const spawn = src.indexOf('this.worker = new Worker(this.getWorkerPath());', src.indexOf('private getWorker'));
    assert.ok(write > -1, 'LocalEmbeddingProvider must write the embeddings sentinel');
    assert.ok(spawn > -1, 'getWorker() must construct the Worker');
    assert.ok(write < spawn, 'sentinel write must happen BEFORE new Worker(...)');
});

test('LocalEmbeddingProvider clears the sentinel on status === "ready"', () => {
    const src = readSrc('electron/rag/providers/LocalEmbeddingProvider.ts');
    const readyIdx = src.indexOf("if (msg.status.type === 'ready')");
    const clearIdx = src.indexOf("clearOnnxLoadSentinel('embeddings',", readyIdx);
    assert.ok(readyIdx > -1 && clearIdx > -1, 'must clear sentinel on ready status');
    assert.ok(clearIdx > readyIdx, 'clear must be inside the ready branch');
});

test('LocalEmbeddingProvider clears the sentinel on clean exit (code === 0)', () => {
    const src = readSrc('electron/rag/providers/LocalEmbeddingProvider.ts');
    const exitIdx = src.indexOf("this.worker.on('exit'");
    assert.ok(exitIdx > -1, 'must register exit handler');
    const cleanExitIdx = src.indexOf('if (code === 0) clearOnnxLoadSentinel', exitIdx);
    assert.ok(cleanExitIdx > -1, 'exit handler must clear sentinel on clean exit');
    assert.ok(cleanExitIdx > exitIdx, 'clear must be inside the exit handler');
});

test('ensureLoaded gates on startupPoisoned', () => {
    const src = readSrc('electron/rag/providers/LocalEmbeddingProvider.ts');
    const ensureBody = src.slice(src.indexOf('private async ensureLoaded'));
    assert.ok(ensureBody.includes('if (startupPoisoned)'), 'ensureLoaded must short-circuit on poison');
});

test('exports consume + reset helpers', () => {
    const src = readSrc('electron/rag/providers/LocalEmbeddingProvider.ts');
    assert.ok(/export function consumeLocalEmbeddingSentinel\b/.test(src));
    assert.ok(/export function clearLocalEmbeddingPoison\b/.test(src));
    assert.ok(/export function isLocalEmbeddingPoisoned\b/.test(src));
});
