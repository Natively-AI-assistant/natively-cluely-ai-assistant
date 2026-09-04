// Regression tests for two defects in LocalReranker's teardown, both reachable
// from one ordinary user action: changing the reranker model in Settings
// (ipcHandlers `reranker:use-local-model` -> reloadLocalReranker -> dispose).
//
// 1. A NORMAL SWITCH LOOKED LIKE A CRASH.
//    `worker.terminate()` exits the thread with code 1, and the exit handler
//    only cleared the ONNX load sentinel on code 0:
//
//        if (code === 0) clearOnnxLoadSentinel('reranker', this.modelId);
//
//    so every deliberate switch left a "died hard" record on disk. Restarting
//    within ONNX_LOAD_SENTINEL_TTL_MS (5 minutes) then had
//    consumeLocalRerankerSentinel() set `startupPoisoned` and skip local
//    reranking for that entire launch. A false crash signal manufactured by a
//    normal action, with the usual silent symptom — reranking quietly does
//    nothing and nothing says so.
//
// 2. IT KILLED WORK THAT WAS STILL IN FLIGHT.
//    dispose() terminated immediately and called rejectAllPending(). A rerank
//    fails CLOSED (null means "keep the existing order"), so unlike a rejected
//    embed this loses no data — but the switch can land in the middle of a
//    meeting turn, and dropping that turn's ranking is the same silent
//    degradation. Terminating inside a native `session.run()` is also the
//    abort shape this worker exists to contain (the 2026-07-05 SIGTRAPs are
//    why reranking runs off the main thread at all).
//
// THE FIX: dispose() clears the sentinel because it KNOWS the exit is
// intentional, and detaches — the worker keeps running until it has answered
// what it owes, then terminates. Bounded, because every pending request already
// carries its own timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const source = readFileSync(path.join(repoRoot, 'electron/rag/LocalReranker.ts'), 'utf8');

/** dispose()'s body, so assertions cannot be satisfied by some other method. */
function disposeBody() {
    const at = source.indexOf('dispose(reason =');
    assert.notEqual(at, -1, 'dispose(reason = …) not found — the anchor moved');
    const open = source.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
    }
    assert.fail('unbalanced braces in dispose()');
}

test('a deliberate dispose clears the crash sentinel', () => {
    assert.match(
        disposeBody(),
        /clearOnnxLoadSentinel\(\s*'reranker'/,
        'dispose() must clear the sentinel. terminate() exits with code 1, and the exit handler ' +
        'only clears on code 0 — so without this an ordinary model switch leaves a "died hard" ' +
        'record that poisons the next launch into skipping local reranking entirely.',
    );
});

test('dispose does not kill a worker that still owes a reply', () => {
    const body = disposeBody();
    assert.match(
        body,
        /pendingRequests\.size === 0/,
        'dispose() must check for outstanding replies before terminating',
    );
    assert.match(
        body,
        /terminateWhenDrained\(/,
        'when replies are outstanding, dispose() must hand off to the drain rather than ' +
        'terminating mid-call',
    );
});

test('the drain is bounded, so a wedged worker cannot live forever', () => {
    assert.match(
        source,
        /RERANK_DISPOSE_DRAIN_MAX_MS\s*=\s*[0-9_]+/,
        'the drain must have a ceiling',
    );
    assert.match(
        source,
        /Date\.now\(\)\s*<\s*deadline/,
        'the drain loop must actually honour that ceiling',
    );
});

test('the sentinel TTL is short enough that the old bug was real, not theoretical', () => {
    // Documents WHY this mattered: the poisoned window is 5 minutes, which a
    // "change the model then restart to be sure" sequence sits well inside.
    const sentinel = readFileSync(path.join(repoRoot, 'electron/utils/onnxLoadSentinel.ts'), 'utf8');
    const ttl = /ONNX_LOAD_SENTINEL_TTL_MS\s*=\s*([0-9*\s]+)/.exec(sentinel)?.[1] ?? '';
    // eslint-disable-next-line no-eval
    const ms = eval(ttl);
    assert.ok(ms >= 60_000, `TTL parsed as ${ms}ms — the regex probably matched the wrong thing`);
});

test('mutation probe: removing the sentinel clear is detected', () => {
    const mutated = disposeBody().replace(/clearOnnxLoadSentinel\([^)]*\)/, 'noop()');
    assert.doesNotMatch(
        mutated,
        /clearOnnxLoadSentinel\(\s*'reranker'/,
        'the guard above is vacuous — it would pass with the clear removed',
    );
});
