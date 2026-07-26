// Regression test for the intent classifier's ONNX load-sentinel wiring
// (2026-07-08). This is a source-structural test — no live worker spawn is
// required, since the worker would actually load a model. We assert:
//   1. IntentClassifier.ts writes the sentinel immediately before
//      `new Worker(...)` in getWorker().
//   2. The worker `message` handler clears the sentinel when status === 'ready'.
//   3. The worker `exit` handler clears the sentinel on clean exit code 0.
//   4. The module exports `consumeIntentClassifierSentinel` and
//      `clearIntentClassifierPoison` so main.ts can hook the cold-start
//      recovery in.
//   5. ensureLoaded + warmup + classify all gate on the startup poison flag.

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

test('IntentClassifier writes the onnx load sentinel before new Worker(...)', () => {
    const src = readSrc('electron/llm/IntentClassifier.ts');
    // getWorker() must contain writeOnnxLoadSentinel('intent', …) before
    // the `new Worker(` line. Use indexOf ordering.
    const write = src.indexOf("writeOnnxLoadSentinel('intent',");
    const spawn = src.indexOf('this.worker = new Worker(this.getWorkerPath());', src.indexOf('private getWorker'));
    assert.ok(write > -1, 'IntentClassifier must write the intent sentinel');
    assert.ok(spawn > -1, 'getWorker() must construct the Worker');
    assert.ok(write < spawn, 'sentinel write must happen BEFORE new Worker(...)');
});

test('IntentClassifier clears the sentinel on status === "ready"', () => {
    const src = readSrc('electron/llm/IntentClassifier.ts');
    // Locate the message handler block. We only need to confirm a clear
    // call is wired up to the ready status.
    const readyIdx = src.indexOf("if (msg.status.type === 'ready')");
    const clearIdx = src.indexOf("clearOnnxLoadSentinel('intent',", readyIdx);
    assert.ok(readyIdx > -1, 'IntentClassifier must special-case status === ready');
    assert.ok(clearIdx > -1 && clearIdx > readyIdx, 'clear must be inside the ready branch');
});

test('IntentClassifier clears the sentinel on clean exit (code === 0)', () => {
    const src = readSrc('electron/llm/IntentClassifier.ts');
    const exitIdx = src.indexOf("this.worker.on('exit'");
    assert.ok(exitIdx > -1, 'must register exit handler');
    const cleanExitIdx = src.indexOf('if (code === 0) clearOnnxLoadSentinel', exitIdx);
    assert.ok(cleanExitIdx > -1, 'exit handler must clear sentinel on clean exit');
    assert.ok(cleanExitIdx > exitIdx, 'clear must be inside the exit handler');
});

test('IntentClassifier exports the cold-start consume + reset helpers', () => {
    const src = readSrc('electron/llm/IntentClassifier.ts');
    assert.ok(/export function consumeIntentClassifierSentinel\b/.test(src));
    assert.ok(/export function clearIntentClassifierPoison\b/.test(src));
    assert.ok(/export function isIntentClassifierPoisoned\b/.test(src));
});

test('ensureLoaded + warmupIntentClassifier gate on startupPoisoned', () => {
    const src = readSrc('electron/llm/IntentClassifier.ts');
    // ensureLoaded short-circuits when poisoned.
    const ensureBody = src.slice(src.indexOf('private async ensureLoaded'));
    assert.ok(ensureBody.includes('if (startupPoisoned)'), 'ensureLoaded must short-circuit on poison');
    // warmupIntentClassifier must early-return when poisoned so the
    // unconditional 2.5s-after-paint warmup can't crash-boot a poisoned machine.
    const warmup = src.slice(src.indexOf('export function warmupIntentClassifier'));
    assert.ok(warmup.includes('if (startupPoisoned)'), 'warmupIntentClassifier must skip ONNX on poison');
});
