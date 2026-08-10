/**
 * CorruptModelPurge2026_08_06.test.mjs
 *
 * THE BUG THIS PINS — a truncated download that presents as "every model fails
 * to install", and survives restarts:
 *
 *   isModelCached() asserts only `size > 0` per file. That was written to catch a
 *   0-byte stub, and it does. But a download that stopped part-way through — the
 *   observed case was 121,049,440 bytes of a 352,839,390-byte encoder — passes
 *   every check it makes. LocalModelDownloadService then verifies the install by
 *   calling isModelCached, sees "cached", and marks it COMPLETE. The UI shows the
 *   model installed. Every load fails with "Protobuf parsing failed", because ORT
 *   walks the file and hits EOF mid-message. And because the cache check still
 *   returns true, nothing ever re-fetches it.
 *
 *   The state is therefore self-perpetuating: the user presses Install, the
 *   service short-circuits on the cache check, and the same bad bytes fail again.
 *
 * The fix is to treat a load failure as a corrupt-cache signal and purge, so the
 * next Install genuinely re-downloads. These tests cover the classification —
 * which errors mean "bad bytes" versus "this machine cannot run models at all" —
 * because getting that boundary wrong is expensive in both directions: too broad
 * and a macOS-12 user loses a good 350 MB download to an environment error too
 * narrow and the stuck state comes back.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/CorruptModelPurge2026_08_06.test.mjs
 * (or `node --test` once dist-electron is built)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const MODEL_MANAGER = join(REPO_ROOT, 'electron/audio/whisper/modelManager.ts');
const LOCAL_WHISPER = join(REPO_ROOT, 'electron/audio/LocalWhisperSTT.ts');

const managerSrc = readFileSync(MODEL_MANAGER, 'utf8');
const whisperSrc = readFileSync(LOCAL_WHISPER, 'utf8');

/**
 * Evaluate isCorruptModelError out of the TypeScript source.
 *
 * Extracted rather than imported because modelManager pulls in electron's `app`
 * at module load, which is unavailable under a plain `node --test`. The function
 * is self-contained string logic, so lifting the body is exact — and it keeps
 * this test runnable without a build step, which is the difference between a
 * guard that runs and one that rots.
 */
function loadIsCorruptModelError() {
    const start = managerSrc.indexOf('export function isCorruptModelError');
    assert.ok(start > -1, 'isCorruptModelError not found in modelManager.ts');
    const open = managerSrc.indexOf('{', start);

    // Walk braces to find the function's true end.
    let depth = 0;
    let end = -1;
    for (let i = open; i < managerSrc.length; i++) {
        if (managerSrc[i] === '{') depth++;
        else if (managerSrc[i] === '}') {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.ok(end > -1, 'Could not find the end of isCorruptModelError');

    const body = managerSrc.slice(open, end).replace(/: string/g, '').replace(/: boolean/g, '');
    // eslint-disable-next-line no-new-func
    return new Function('message', `${body.slice(1, -1)}`);
}

const isCorruptModelError = loadIsCorruptModelError();

describe('corrupt local model purge', () => {
    test('the real observed failure is classified as corrupt', () => {
        // Verbatim from the reported log.
        const real = 'Load model from /Users/evin/Library/Application Support/natively/'
            + 'whisper-models/distil-whisper/distil-small.en/onnx/encoder_model.onnx '
            + 'failed:Protobuf parsing failed.';
        assert.equal(
            isCorruptModelError(real),
            true,
            'The exact protobuf error from the field must trigger a purge, or the model stays stuck forever.',
        );
    });

    test('environment failures are NOT treated as corrupt', () => {
        // macOS 12: onnxruntime-node links libc++ symbols only exported on 13+.
        // NO model can load on this host. Purging would delete a perfectly good
        // multi-hundred-megabyte download to fix nothing.
        const envFailures = [
            'Failed to load model: Symbol not found: __ZNSt3__18to_charsEPcS0_d',
            'dlopen(libonnxruntime.1.22.0.dylib): image not found',
            'Error: Symbol not found, expected in flat namespace',
        ];
        for (const msg of envFailures) {
            assert.equal(
                isCorruptModelError(msg),
                false,
                `"${msg}" is an environment failure, not bad bytes — purging would destroy a valid download.`,
            );
        }
    });

    test('other malformed-file shapes are covered', () => {
        for (const msg of [
            'Failed to load model: invalid model',
            'Load model from /x/encoder_model.onnx failed:No such file or directory',
        ]) {
            assert.equal(isCorruptModelError(msg), true, `Expected "${msg}" to be treated as corrupt`);
        }
    });

    test('empty and junk input do not throw or purge', () => {
        // Defensive: this runs on an error path, where the last thing wanted is a
        // second exception, and an unrecognised message must not delete anything.
        for (const msg of ['', undefined, null]) {
            assert.doesNotThrow(() => isCorruptModelError(msg));
            assert.equal(isCorruptModelError(msg), false);
        }
    });

    test('LocalWhisperSTT purges on load failure and says so', () => {
        // The wiring, not just the predicate: a classifier nothing calls fixes nothing.
        assert.match(
            whisperSrc,
            /purgeCorruptModel\(this\.modelId/,
            'LocalWhisperSTT must purge the corrupt model on a load failure, or the cache check keeps reporting it installed.',
        );
        assert.match(
            whisperSrc,
            /isCorruptModelError\(msg\.message\)/,
            'The purge must be gated on the corruption classifier, not fired for every load failure.',
        );
        // The old copy claimed "model not found" while the files were sitting right
        // there, and pointed at a download that silently no-opped.
        assert.match(
            whisperSrc,
            /files were incomplete and have been removed/,
            'After a purge the user must be told the files were removed and to reinstall.',
        );
    });

    test('the symbol-error guard runs before the purge', () => {
        // Ordering matters: isOnnxSymbolError must be computed and checked first,
        // so a macOS-12 host never reaches the purge branch.
        const purgeIdx = whisperSrc.indexOf('purgeCorruptModel(this.modelId');
        const guardIdx = whisperSrc.indexOf('if (!isOnnxSymbolError)');
        assert.ok(guardIdx > -1, 'Expected an isOnnxSymbolError guard around the purge');
        assert.ok(
            guardIdx < purgeIdx,
            'The environment-error guard must wrap the purge, not follow it.',
        );
    });
});
