// Regression test for the generalized ONNX recovery-notice IPC plumbing
// (2026-07-08). Mirrors the existing local-whisper recovery notice flow but
// generalized to the four local-model families (whisper / intent /
// embeddings / reranker). Source-structural + a small AppState smoke test.

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

test('AppState exposes setOnnxRecoveryNotice + takeOnnxRecoveryNotice', () => {
    const src = readSrc('electron/main.ts');
    assert.ok(src.includes('setOnnxRecoveryNotice'), 'AppState must expose setOnnxRecoveryNotice');
    assert.ok(src.includes('takeOnnxRecoveryNotice'), 'AppState must expose takeOnnxRecoveryNotice');
    // take must null the field after returning it, so the renderer never
    // sees the same notice twice across reloads.
    const take = src.indexOf('takeOnnxRecoveryNotice');
    const body = src.slice(take, take + 500);
    assert.ok(body.includes('delete this.onnxRecoveryNotices'), 'takeOnnxRecoveryNotice must delete the stash to be one-shot');
});

test('main.ts consumes intent/embeddings/reranker sentinels at cold start', () => {
    const src = readSrc('electron/main.ts');
    // Find the second setImmediate block (the generalized sentinel consume).
    // Anchor on the CALL expression `consumeIntentClassifierSentinel()` (with
    // parens) so the require() statement at line 837 is not matched. Then
    // walk forward to a safe terminator — the closing of the setImmediate
    // block — so the slice covers all three consume + stash branches.
    const consumeStart = src.indexOf('consumeIntentClassifierSentinel()');
    assert.ok(consumeStart > -1, 'main.ts must call consumeIntentClassifierSentinel');
    // The block ends with the catch clause's closing brace; search for the
    // first `} catch` (or `})` ) after the consume calls. Practical anchor:
    // 3500 chars after the start of the block is more than enough for the
    // ~80-line block.
    const block = src.slice(consumeStart, consumeStart + 3500);
    assert.ok(block.includes("setOnnxRecoveryNotice('intent'"), 'intent notice must be stashed');
    assert.ok(block.includes("setOnnxRecoveryNotice('embeddings'"), 'embeddings notice must be stashed');
    assert.ok(block.includes("setOnnxRecoveryNotice('reranker'"), 'reranker notice must be stashed');
    assert.ok(block.includes("clearLocalEmbeddingPoison") || block.includes('Non-fatal'), 'must be inside the consume setImmediate');
});

test('ipcHandlers registers the onnx-get-recovery-notice + onnx-reset-family IPCs', () => {
    const src = readSrc('electron/ipcHandlers.ts');
    assert.ok(src.includes("safeHandle('onnx-get-recovery-notice'"), 'must register onnx-get-recovery-notice');
    assert.ok(src.includes("safeHandle('onnx-reset-family'"), 'must register onnx-reset-family');
    // The reset handler must delegate to the per-family clear helpers.
    const resetBody = src.slice(src.indexOf("safeHandle('onnx-reset-family'"));
    assert.ok(resetBody.includes('clearIntentClassifierPoison'), 'reset must clear intent poison');
    assert.ok(resetBody.includes('clearLocalEmbeddingPoison'), 'reset must clear embedding poison');
    assert.ok(resetBody.includes('clearLocalRerankerPoison'), 'reset must clear reranker poison');
});

test('preload exposes onnxGetRecoveryNotice + onnxResetFamily on the renderer bridge', () => {
    const preload = readSrc('electron/preload.ts');
    assert.ok(preload.includes('onnxGetRecoveryNotice'), 'preload must expose onnxGetRecoveryNotice');
    assert.ok(preload.includes('onnxResetFamily'), 'preload must expose onnxResetFamily');
    assert.ok(preload.includes("ipcRenderer.invoke('onnx-get-recovery-notice'"), 'preload must invoke the recovery IPC');
    assert.ok(preload.includes("ipcRenderer.invoke('onnx-reset-family'"), 'preload must invoke the reset IPC');
});

test('renderer LocalWhisperModelPanel renders a recovery chip per poisoned family', () => {
    const src = readSrc('src/components/LocalWhisperModelPanel.tsx');
    assert.ok(src.includes('OnnxRecoveryChip'), 'must define OnnxRecoveryChip');
    assert.ok(src.includes('onnxGetRecoveryNotice'), 'must pull notices via electronAPI');
    assert.ok(src.includes("electronAPI?.onnxGetRecoveryNotice?.('intent')"), 'must pull intent notice');
    assert.ok(src.includes("electronAPI?.onnxGetRecoveryNotice?.('embeddings')"), 'must pull embeddings notice');
    assert.ok(src.includes("electronAPI?.onnxGetRecoveryNotice?.('reranker')"), 'must pull reranker notice');
    assert.ok(src.includes('Retry now'), 'must surface a Retry now action');
    assert.ok(src.includes("electronAPI?.onnxResetFamily?.(family)"), 'Retry must call onnxResetFamily');
});
