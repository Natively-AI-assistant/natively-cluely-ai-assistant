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
    // The invariant is that dispose NEVER terminates inline — it always hands
    // off to the drain, which waits for outstanding replies and only then asks
    // the worker to release its ONNX sessions and stop. An earlier version had
    // a `pendingRequests.size === 0` fast path that terminated directly; that
    // is gone precisely because it raced work that had not registered yet.
    assert.match(
        body,
        /terminateWhenDrained\(/,
        'dispose() must hand off to the drain rather than terminating mid-call',
    );
    assert.doesNotMatch(
        body,
        /worker\.terminate\(/,
        'dispose() must not terminate the worker inline — anything already in flight, or about ' +
        'to register, would be killed with it',
    );
});

test('the drain releases the ONNX sessions before stopping the thread', () => {
    // transformers.js exposes PreTrainedModel.dispose() — "one promise for each
    // ONNX session that is being disposed". Terminating skipped it entirely.
    //
    // MEASURED 2026-09-04 on the bundled ms-marco-MiniLM-L-6-v2: this recovers
    // NO memory (26-27 MB released either way, ~79 MB retained regardless), so
    // it is kept for teardown correctness and for not unwinding the thread
    // inside a native model(inputs) call — NOT as a memory fix.
    assert.match(
        source,
        /releaseThenTerminate\(/,
        'the drain must go through the release path',
    );
    assert.match(
        source,
        /postTo\(worker, \{ type: 'dispose' \}/,
        "the release must post {type:'dispose'} to the worker that is going away, not through " +
        'getWorker() — which would spawn a replacement thread just to shut it down',
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
