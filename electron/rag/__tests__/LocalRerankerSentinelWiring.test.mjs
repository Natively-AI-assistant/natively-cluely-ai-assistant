// Regression test for the local reranker's ONNX load-sentinel wiring
// (2026-07-08). Also gates the dead-latch fix — loadFailed must now be
// assigned `true` in the worker error/exit handlers when the worker dies
// before the model is fully loaded. Source-structural.

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

test('LocalReranker writes the onnx load sentinel before new Worker(...)', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    const write = src.indexOf("writeOnnxLoadSentinel('reranker',");
    const spawn = src.indexOf('this.worker = new Worker(this.getWorkerPath());', src.indexOf('private getWorker'));
    assert.ok(write > -1, 'LocalReranker must write the reranker sentinel');
    assert.ok(spawn > -1, 'getWorker() must construct the Worker');
    assert.ok(write < spawn, 'sentinel write must happen BEFORE new Worker(...)');
});

test('LocalReranker clears the sentinel on worker `ready` message', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    // The previous version had only `if (msg.type === 'error')` + fall-through;
    // the new version must special-case `ready` to clear the sentinel
    // (the `ready` message is what the worker posts after ONNX session init).
    const clearIdx = src.indexOf("clearOnnxLoadSentinel('reranker',");
    assert.ok(clearIdx > -1, 'must clear sentinel on worker ready');
    assert.ok(src.indexOf("msg.type === 'ready'") > -1, 'message handler must recognize ready');
});

test('LocalReranker clears the sentinel on clean exit (code === 0)', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    const exitIdx = src.indexOf("this.worker.on('exit'");
    assert.ok(exitIdx > -1, 'must register exit handler');
    const cleanExitIdx = src.indexOf('if (code === 0) clearOnnxLoadSentinel', exitIdx);
    assert.ok(cleanExitIdx > -1, 'exit handler must clear sentinel on clean exit');
    assert.ok(cleanExitIdx > exitIdx, 'clear must be inside the exit handler');
});

test('dead-latch fix: loadFailed is now assigned true on worker death-before-ready', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    // After the fix, both the worker `error` and the `exit` handler must set
    // `this.loadFailed = true` when `!this.loaded` (i.e. died before model
    // was fully loaded). Pre-fix this was literally never assigned, so the
    // next isAvailable() always re-spawned against the broken asset.
    const errorBranch = src.indexOf("this.worker.on('error'");
    const exitBranch = src.indexOf("this.worker.on('exit'");
    assert.ok(errorBranch > -1 && exitBranch > -1);
    // Count the `loadFailed = true` assignments — must be at least 2
    // (one in error, one in exit).
    const matches = [...src.matchAll(/this\.loadFailed\s*=\s*true/g)];
    // _resetForTests and __resetForTests clear to false; that's not a
    // "set to true" assignment. The fix adds `this.loadFailed = true`
    // INSIDE the error/exit handlers. We assert at least 2 such
    // assignments exist.
    assert.ok(matches.length >= 2, `expected ≥2 loadFailed=true assignments, got ${matches.length}`);
});

test('exports consume + reset helpers', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    assert.ok(/export function consumeLocalRerankerSentinel\b/.test(src));
    assert.ok(/export function clearLocalRerankerPoison\b/.test(src));
    assert.ok(/export function isLocalRerankerPoisoned\b/.test(src));
});

test('ensureLoaded + isAvailable gate on startupPoisoned', () => {
    const src = readSrc('electron/rag/LocalReranker.ts');
    const isAvail = src.slice(src.indexOf('async isAvailable()'), src.indexOf('private async ensureLoaded'));
    assert.ok(isAvail.includes('if (startupPoisoned)'), 'isAvailable must short-circuit on poison');
    const ensureBody = src.slice(src.indexOf('private async ensureLoaded'));
    assert.ok(ensureBody.includes('if (startupPoisoned)'), 'ensureLoaded must short-circuit on poison');
});
